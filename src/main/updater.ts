/**
 * In-app updater: check a GitHub Release feed, download the matching
 * installer, verify SHA-256, then hand off to the platform installer.
 *
 * This is the Electron counterpart of agent-skills-guard's Tauri updater.
 * electron-updater is not used: packages are unsigned, and the release
 * workflow already assembles GitHub Releases itself (it must not let
 * electron-builder infer a publish provider).
 * @module dsh-desktop/updater
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { shell } from 'electron'

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restartRequired'
  | 'upToDate'
  | 'error'

export interface UpdateInfo {
  currentVersion: string
  availableVersion: string
  notes?: string
  pubDate?: string
  downloadUrl: string
  sha256?: string
  fileName: string
}

export interface UpdateProgress {
  total: number
  downloaded: number
  percent: number
}

export interface UpdateState {
  phase: UpdaterPhase
  currentVersion: string
  info: UpdateInfo | null
  progress: UpdateProgress | null
  error: string | null
  dismissed: boolean
  isChecking: boolean
}

export type CheckUpdateResult =
  | { hasUpdate: false }
  | { hasUpdate: true; info: UpdateInfo }

export interface UpdateFeedPlatform {
  url: string
  sha256?: string
}

export interface UpdateFeed {
  version: string
  notes?: string
  pubDate?: string
  platforms: Record<string, UpdateFeedPlatform>
}

export interface UpdaterPersistence {
  dismissedVersion?: string
  lastCheckedAt?: number
}

export interface DesktopUpdaterOptions {
  currentVersion: string
  feedUrl: string
  githubApiUrl?: string
  platform: NodeJS.Platform
  arch: string
  packaged: boolean
  downloadDir: string
  loadPersistence: () => UpdaterPersistence
  savePersistence: (next: UpdaterPersistence) => void
  /** When true, download+verify but do not spawn the installer or quit. */
  dryRun: boolean
  now?: () => number
  fetchImpl?: typeof fetch
}

const CHECK_TIMEOUT_MS = 30_000
const DOWNLOAD_IDLE_TIMEOUT_MS = envMs('DSH_DESKTOP_UPDATE_DOWNLOAD_IDLE_MS', 30_000)
const DOWNLOAD_TIMEOUT_MS = envMs('DSH_DESKTOP_UPDATE_DOWNLOAD_MS', 15 * 60 * 1000)
const PROGRESS_EMIT_MIN_INTERVAL_MS = 100
export const AUTO_CHECK_DELAY_MS = 4_000
export const AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
const DEFAULT_FEED_URL = 'https://github.com/bruc3van/dsh-desktop/releases/latest/download/latest.json'
const DEFAULT_GITHUB_API = 'https://api.github.com/repos/bruc3van/dsh-desktop/releases/latest'

const GITHUB_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

export function defaultUpdateFeedUrl(): string {
  return process.env.DSH_DESKTOP_UPDATE_FEED?.trim() || DEFAULT_FEED_URL
}

export function defaultGithubApiUrl(): string | undefined {
  const override = process.env.DSH_DESKTOP_UPDATE_GITHUB_API
  if (override !== undefined) {
    const trimmed = override.trim()
    return trimmed === '' ? undefined : trimmed
  }
  return DEFAULT_GITHUB_API
}

/** Semver-ish compare: core numbers first, then prerelease (none > any). */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const length = Math.max(a.core.length, b.core.length)
  for (let i = 0; i < length; i++) {
    const av = a.core[i] ?? 0
    const bv = b.core[i] ?? 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  const leftPre = a.prerelease
  const rightPre = b.prerelease
  if (leftPre === undefined && rightPre !== undefined) return 1
  if (leftPre !== undefined && rightPre === undefined) return -1
  if (leftPre === rightPre) return 0
  return (leftPre ?? '') < (rightPre ?? '') ? -1 : 1
}

function parseVersion(input: string): { core: number[]; prerelease?: string } {
  const cleaned = input.trim().replace(/^v/i, '')
  const plus = cleaned.indexOf('+')
  const withoutBuild = plus === -1 ? cleaned : cleaned.slice(0, plus)
  const dash = withoutBuild.indexOf('-')
  const coreText = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const prerelease = dash === -1 ? undefined : withoutBuild.slice(dash + 1)
  const core = coreText.split('.').map((part) => {
    const n = Number(part)
    return Number.isFinite(n) ? n : 0
  })
  while (core.length < 3) core.push(0)
  return prerelease === undefined ? { core } : { core, prerelease }
}

/** Platform key used in latest.json and matching release asset names. */
export function platformKey(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === 'win32' && arch === 'arm64') return 'win-arm64'
  if (platform === 'win32') return 'win-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64'
  if (platform === 'darwin') return 'mac-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (platform === 'linux') return 'linux-x64'
  return undefined
}

export function parseSha256Sums(text: string): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)
    if (match === null) continue
    const hash = match[1]
    const name = match[2]
    if (hash === undefined || name === undefined) continue
    hashes.set(name.trim().replace(/^\.\//, ''), hash.toLowerCase())
  }
  return hashes
}

export function isAllowedDownloadUrl(target: string, feedUrl: string): boolean {
  let url: URL
  let feed: URL
  try {
    url = new URL(target)
    feed = new URL(feedUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.origin === feed.origin) return true
  if (url.protocol !== 'https:') return false
  return GITHUB_DOWNLOAD_HOSTS.has(url.hostname) || url.hostname.endsWith('.githubusercontent.com')
}

export function pickFeedPlatform(feed: UpdateFeed, key: string): UpdateFeedPlatform | undefined {
  return feed.platforms[key]
}

interface GithubReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface GithubRelease {
  tag_name?: unknown
  body?: unknown
  published_at?: unknown
  assets?: unknown
}

interface FeedWithSums extends UpdateFeed {
  sumsUrl?: string
}

export function parseUpdateFeed(raw: unknown): UpdateFeed {
  if (raw === null || typeof raw !== 'object') throw new Error('更新清单格式无效')
  const body = raw as {
    version?: unknown
    notes?: unknown
    pubDate?: unknown
    platforms?: unknown
  }
  if (typeof body.version !== 'string' || body.version.trim() === '') {
    throw new Error('更新清单缺少版本号')
  }
  if (body.platforms === null || typeof body.platforms !== 'object' || Array.isArray(body.platforms)) {
    throw new Error('更新清单缺少平台列表')
  }
  const platforms: Record<string, UpdateFeedPlatform> = {}
  for (const [name, value] of Object.entries(body.platforms as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue
    const platform = value as { url?: unknown; sha256?: unknown }
    if (typeof platform.url !== 'string' || platform.url.trim() === '') continue
    platforms[name] = {
      url: platform.url,
      ...typeof platform.sha256 === 'string' && { sha256: platform.sha256.toLowerCase() },
    }
  }
  return {
    version: body.version.trim().replace(/^v/i, ''),
    ...typeof body.notes === 'string' && { notes: body.notes },
    ...typeof body.pubDate === 'string' && { pubDate: body.pubDate },
    platforms,
  }
}

export class DesktopUpdater {
  private phase: UpdaterPhase = 'idle'
  private info: UpdateInfo | null = null
  private progress: UpdateProgress | null = null
  private error: string | null = null
  private dismissed = false
  private checking = false
  private checkInFlight: Promise<CheckUpdateResult> | undefined
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(private readonly options: DesktopUpdaterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.syncDismissedFromStore()
  }

  getState(): UpdateState {
    return {
      phase: this.phase,
      currentVersion: this.options.currentVersion,
      info: this.info,
      progress: this.progress,
      error: this.error,
      dismissed: this.dismissed,
      isChecking: this.checking,
    }
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  shouldAutoCheck(): boolean {
    if (process.env.DSH_DESKTOP_SKIP_UPDATE_CHECK === '1') return false
    if (!this.options.packaged && process.env.DSH_DESKTOP_UPDATE_FEED === undefined) return false
    const persisted = this.options.loadPersistence()
    const last = persisted.lastCheckedAt
    if (last !== undefined && this.now() - last < AUTO_CHECK_INTERVAL_MS) return false
    return true
  }

  async check(): Promise<CheckUpdateResult> {
    if (this.checkInFlight !== undefined) return this.checkInFlight
    if (
      this.phase === 'downloading'
      || this.phase === 'installing'
      || this.phase === 'restartRequired'
    ) {
      return this.info === null ? { hasUpdate: false } : { hasUpdate: true, info: this.info }
    }

    const run = this.performCheck()
    this.checkInFlight = run
    try {
      return await run
    } finally {
      if (this.checkInFlight === run) this.checkInFlight = undefined
    }
  }

  private async performCheck(): Promise<CheckUpdateResult> {
    this.checking = true
    this.error = null
    this.setPhase('checking')
    try {
      const feed = await this.loadFeed()
      const key = platformKey(this.options.platform, this.options.arch)
      if (key === undefined) {
        this.info = null
        this.dismissed = false
        this.setPhase('upToDate')
        this.markChecked()
        return { hasUpdate: false }
      }
      const platform = pickFeedPlatform(feed, key)
      if (platform === undefined || compareVersions(feed.version, this.options.currentVersion) <= 0) {
        this.info = null
        this.dismissed = false
        this.setPhase('upToDate')
        this.markChecked()
        return { hasUpdate: false }
      }

      const fileName = fileNameFromUrl(platform.url) ?? `dsh-desktop-${feed.version}-${key}`
      const info: UpdateInfo = {
        currentVersion: this.options.currentVersion,
        availableVersion: feed.version,
        downloadUrl: platform.url,
        fileName,
        ...feed.notes !== undefined && { notes: feed.notes },
        ...feed.pubDate !== undefined && { pubDate: feed.pubDate },
        ...platform.sha256 !== undefined && { sha256: platform.sha256 },
      }
      this.info = info
      const persisted = this.options.loadPersistence()
      this.dismissed = persisted.dismissedVersion === info.availableVersion
      this.setPhase('available')
      this.markChecked()
      return { hasUpdate: true, info }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.setPhase('error')
      return { hasUpdate: false }
    } finally {
      this.checking = false
      this.emit()
    }
  }

  dismiss(): void {
    if (this.info === null) return
    this.dismissed = true
    this.options.savePersistence({
      ...this.options.loadPersistence(),
      dismissedVersion: this.info.availableVersion,
    })
    this.emit()
  }

  resetDismiss(): void {
    this.dismissed = false
    const persisted = this.options.loadPersistence()
    if (persisted.dismissedVersion === undefined) {
      this.emit()
      return
    }
    this.options.savePersistence({ ...persisted, dismissedVersion: undefined })
    this.emit()
  }

  async install(): Promise<{ started: boolean; error?: string }> {
    const info = this.info
    if (info === null) return { started: false, error: '没有可安装的更新' }
    if (this.phase === 'downloading' || this.phase === 'installing' || this.phase === 'restartRequired') {
      return { started: false, error: '更新正在进行中' }
    }
    if (info.sha256 === undefined) {
      return { started: false, error: '安装包缺少 SHA-256，已拒绝安装' }
    }

    this.error = null
    this.progress = { total: 0, downloaded: 0, percent: 0 }
    this.setPhase('downloading')

    const destination = joinDownloadPath(this.options.downloadDir, info.fileName)
    try {
      await this.downloadToFile(info, destination)
      const actual = await sha256File(destination)
      if (actual !== info.sha256.toLowerCase()) {
        try { unlinkSync(destination) } catch { /* keep going to report the hash error */ }
        throw new Error('安装包校验失败（SHA-256 不匹配）')
      }

      if (this.options.dryRun) {
        this.progress = null
        this.setPhase('available')
        return { started: true }
      }

      this.setPhase('installing')
      await launchInstaller(destination, this.options.platform)
      if (this.options.platform === 'darwin') {
        this.setPhase('restartRequired')
        return { started: true }
      }
      return { started: true }
    } catch (err) {
      this.progress = null
      this.error = err instanceof Error ? err.message : String(err)
      this.setPhase('error')
      return { started: false, error: this.error }
    }
  }

  private markChecked(): void {
    this.options.savePersistence({
      ...this.options.loadPersistence(),
      lastCheckedAt: this.now(),
    })
  }

  private syncDismissedFromStore(): void {
    const persisted = this.options.loadPersistence()
    this.dismissed = persisted.dismissedVersion !== undefined
      && this.info !== null
      && persisted.dismissedVersion === this.info.availableVersion
  }

  private async loadFeed(): Promise<UpdateFeed> {
    try {
      return await this.fetchJsonFeed(this.options.feedUrl)
    } catch (primary) {
      const api = this.options.githubApiUrl
      if (api === undefined) throw primary
      try {
        return await this.fetchGithubApiFeed(api)
      } catch {
        throw primary
      }
    }
  }

  private async fetchJsonFeed(url: string): Promise<UpdateFeed> {
    const response = await this.fetchImpl(url, {
      headers: requestHeaders(this.options.currentVersion),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('检查更新失败（HTTP ' + String(response.status) + '）')
    return parseUpdateFeed(await response.json())
  }

  private async fetchGithubApiFeed(url: string): Promise<UpdateFeed> {
    const response = await this.fetchImpl(url, {
      headers: {
        ...requestHeaders(this.options.currentVersion),
        accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('检查更新失败（HTTP ' + String(response.status) + '）')
    const release = await response.json() as GithubRelease
    const key = platformKey(this.options.platform, this.options.arch)
    if (key === undefined) throw new Error('当前平台暂不支持在线更新')
    const feed = githubReleaseToFeed(release, key)
    if (feed === undefined) throw new Error('最新版本没有当前平台的安装包')
    const platform = feed.platforms[key]
    if (feed.sumsUrl !== undefined && platform !== undefined && platform.sha256 === undefined) {
      const sha256 = await this.fetchAssetSha256(feed.sumsUrl, fileNameFromUrl(platform.url) ?? '')
      if (sha256 !== undefined) platform.sha256 = sha256
    }
    return feed
  }

  private async fetchAssetSha256(sumsUrl: string, fileName: string): Promise<string | undefined> {
    if (fileName === '' || !isAllowedDownloadUrl(sumsUrl, this.options.feedUrl)) return undefined
    try {
      const response = await this.fetchImpl(sumsUrl, {
        headers: requestHeaders(this.options.currentVersion),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })
      if (!response.ok) return undefined
      return parseSha256Sums(await response.text()).get(fileName)
    } catch {
      return undefined
    }
  }

  private async downloadToFile(info: UpdateInfo, destination: string): Promise<void> {
    if (!isAllowedDownloadUrl(info.downloadUrl, this.options.feedUrl)) {
      throw new Error('拒绝从不信任的地址下载更新')
    }
    mkdirSync(dirname(destination), { recursive: true })
    const controller = new AbortController()
    const overallTimer = setTimeout(() => { controller.abort() }, DOWNLOAD_TIMEOUT_MS)
    let idleTimer = setTimeout(() => { controller.abort() }, DOWNLOAD_IDLE_TIMEOUT_MS)
    const bumpIdle = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { controller.abort() }, DOWNLOAD_IDLE_TIMEOUT_MS)
    }
    try {
      const response = await this.fetchImpl(info.downloadUrl, {
        headers: requestHeaders(this.options.currentVersion),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new Error('下载更新失败（HTTP ' + String(response.status) + '）')
      }
      const totalHeader = response.headers.get('content-length')
      const total = totalHeader === null ? 0 : Number(totalHeader)
      let downloaded = 0
      let lastEmittedPercent = -1
      let lastEmitAt = 0
      this.progress = { total: Number.isFinite(total) ? total : 0, downloaded: 0, percent: 0 }
      this.emit()

      const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
      body.on('data', (chunk: Buffer) => {
        bumpIdle()
        downloaded += chunk.length
        const boundedTotal = this.progress?.total ?? 0
        const percent = boundedTotal > 0 ? Math.min(100, Math.round((downloaded / boundedTotal) * 100)) : 0
        this.progress = { total: boundedTotal, downloaded, percent }
        const now = this.now()
        if (percent !== lastEmittedPercent || now - lastEmitAt >= PROGRESS_EMIT_MIN_INTERVAL_MS) {
          lastEmittedPercent = percent
          lastEmitAt = now
          this.emit()
        }
      })
      await pipeline(body, createWriteStream(destination))
      if (this.progress !== null) {
        this.progress = {
          total: this.progress.total,
          downloaded: this.progress.downloaded,
          percent: 100,
        }
        this.emit()
      }
    } catch (err) {
      if (controller.signal.aborted) throw new Error('下载更新超时')
      throw err
    } finally {
      clearTimeout(overallTimer)
      clearTimeout(idleTimer)
    }
  }

  private setPhase(phase: UpdaterPhase): void {
    this.phase = phase
    this.emit()
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

function githubReleaseToFeed(release: GithubRelease, key: string): FeedWithSums | undefined {
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = tag.replace(/^v/i, '')
  if (version === '') return undefined
  const assets = Array.isArray(release.assets) ? release.assets : []
  const expectedExt = key.startsWith('win') ? 'exe' : key.startsWith('linux') ? 'AppImage' : 'dmg'
  const expectedName = `dsh-desktop-${version}-${key}.${expectedExt}`
  let downloadUrl: string | undefined
  let sumsUrl: string | undefined
  for (const item of assets) {
    if (item === null || typeof item !== 'object') continue
    const asset = item as GithubReleaseAsset
    if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') continue
    if (asset.name === expectedName) downloadUrl = asset.browser_download_url
    if (asset.name === 'SHA256SUMS.txt') sumsUrl = asset.browser_download_url
  }
  if (downloadUrl === undefined) return undefined
  const notes = typeof release.body === 'string' ? release.body : undefined
  const pubDate = typeof release.published_at === 'string' ? release.published_at : undefined
  return {
    version,
    ...notes !== undefined && { notes },
    ...pubDate !== undefined && { pubDate },
    platforms: { [key]: { url: downloadUrl } },
    ...sumsUrl !== undefined && { sumsUrl },
  }
}

function requestHeaders(version: string): Record<string, string> {
  return {
    'user-agent': 'dsh-desktop/' + version + ' (+https://github.com/bruc3van/dsh-desktop)',
    accept: 'application/json,application/octet-stream;q=0.9,*/*;q=0.8',
  }
}

function fileNameFromUrl(url: string): string | undefined {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    return name === '' ? undefined : name
  } catch {
    return undefined
  }
}

function joinDownloadPath(dir: string, fileName: string): string {
  return join(dir, fileName.replace(/[\\/]/g, '_'))
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function launchInstaller(filePath: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'darwin') {
    const opened = await shell.openPath(filePath)
    if (opened !== '') throw new Error(opened)
    return
  }
  if (platform === 'win32') {
    const child = spawn(filePath, [], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }
  const opened = await shell.openPath(filePath)
  if (opened !== '') throw new Error(opened)
}
