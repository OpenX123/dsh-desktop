/**
 * In-app updater check: the feed writer emits latest.json, and the packaged
 * shell can check / download / verify / dismiss against a local fixture feed.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const desktopVersion = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version
const work = await mkdtemp(join(tmpdir(), 'dsh-desktop-updater-'))
const artifacts = join(work, 'artifacts')
mkdirSync(artifacts, { recursive: true })

const winBytes = Buffer.from('fake-win-installer')
const macBytes = Buffer.from('fake-mac-installer')
writeFileSync(join(artifacts, 'dsh-desktop-9.9.9-win-x64.exe'), winBytes)
writeFileSync(join(artifacts, 'dsh-desktop-9.9.9-mac-arm64.dmg'), macBytes)
writeFileSync(
  join(artifacts, 'SHA256SUMS.txt'),
  createHash('sha256').update(winBytes).digest('hex') + '  dsh-desktop-9.9.9-win-x64.exe\n'
    + createHash('sha256').update(macBytes).digest('hex') + '  dsh-desktop-9.9.9-mac-arm64.dmg\n',
)

const feedPath = join(artifacts, 'latest.json')
const notesFile = join(work, 'notes.md')
writeFileSync(notesFile, 'release body notes\n')
execFileSync(process.execPath, [
  join(APP_DIR, 'scripts', 'write-update-feed.mjs'),
  '--dir', artifacts,
  '--version', '9.9.9',
  '--repo', 'bruc3van/dsh-desktop',
  '--notes-file', notesFile,
  '--out', feedPath,
], { stdio: 'pipe' })

const written = JSON.parse(readFileSync(feedPath, 'utf8'))
if (written.version !== '9.9.9') throw new Error('feed version: ' + written.version)
if (written.notes !== 'release body notes\n') throw new Error('notes-file not copied: ' + JSON.stringify(written.notes))
if (written.platforms['win-x64']?.sha256 !== createHash('sha256').update(winBytes).digest('hex')) {
  throw new Error('win-x64 sha256 mismatch in generated feed')
}
if (written.platforms['mac-arm64']?.url !== 'https://github.com/bruc3van/dsh-desktop/releases/download/v9.9.9/dsh-desktop-9.9.9-mac-arm64.dmg') {
  throw new Error('mac-arm64 url: ' + written.platforms['mac-arm64']?.url)
}
console.log('✓ write-update-feed.mjs emits latest.json for win-x64 and mac-arm64')
console.log('✓ write-update-feed.mjs copies release notes from --notes-file')

// Version ordering decides whether an offered build counts as newer, and the
// app-level checks below can only exercise it against this package's own
// release version. Bundle the module against an electron stub so the ordering
// rules themselves — including prerelease ranks — are asserted directly.
const electronStub = join(work, 'electron-stub.mjs')
writeFileSync(electronStub, 'export const shell = { openPath: async () => "" }\n')
const updaterBundle = join(work, 'updater.mjs')
await esbuild.build({
  entryPoints: [join(APP_DIR, 'src', 'main', 'updater.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { electron: electronStub },
  outfile: updaterBundle,
  logLevel: 'silent',
})
const { compareVersions } = await import(pathToFileURL(updaterBundle).href)
const orderings = [
  // Numeric prerelease identifiers rank by value: the string comparison this
  // replaced put rc.10 BELOW rc.9 and reported a newer build as current.
  ['0.1.5-rc.10', '0.1.5-rc.9', 1],
  ['0.1.5-rc.9', '0.1.5-rc.10', -1],
  ['0.1.5-rc.2', '0.1.5-rc.2', 0],
  // A release outranks any prerelease of the same core version.
  ['0.1.5', '0.1.5-rc.10', 1],
  ['0.1.5-rc.10', '0.1.5', -1],
  // Numeric identifiers rank below alphanumeric ones; a shorter prefix loses.
  ['1.0.0-alpha.beta', '1.0.0-alpha.1', 1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  // Core numbers still win over everything else.
  ['0.2.0', '0.1.9', 1],
  ['0.1.5', '0.1.5', 0],
]
for (const [left, right, expected] of orderings) {
  const actual = compareVersions(left, right)
  if (Math.sign(actual) !== expected) {
    throw new Error('compareVersions(' + left + ', ' + right + ') = ' + actual + ', expected ' + expected)
  }
}
console.log('✓ compareVersions orders core, release-over-prerelease, and numeric prerelease ranks')

const payload = Buffer.from('desktop-update-payload')
const payloadHash = createHash('sha256').update(payload).digest('hex')
const currentKey = process.platform === 'win32'
  ? (process.arch === 'arm64' ? 'win-arm64' : 'win-x64')
  : process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : process.platform === 'linux'
      ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64')
      : undefined
if (currentKey === undefined) {
  throw new Error('check:updater does not cover ' + process.platform + '/' + process.arch)
}

const availableFeed = {
  version: '99.0.0',
  notes: 'fixture changelog',
  pubDate: '2026-08-14T00:00:00.000Z',
  platforms: {
    [currentKey]: { url: '', sha256: payloadHash },
  },
}
const currentFeed = {
  version: desktopVersion,
  platforms: {
    [currentKey]: { url: '', sha256: payloadHash },
  },
}
const badFeed = {
  version: '99.0.1',
  platforms: {
    [currentKey]: { url: '', sha256: '0'.repeat(64) },
  },
}
const noHashFeed = {
  version: '99.0.2',
  platforms: {
    [currentKey]: { url: '' },
  },
}
const hangFeed = {
  version: '99.0.3',
  platforms: {
    [currentKey]: { url: '', sha256: payloadHash },
  },
}

let feedMode = 'available'
const fixture = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/latest.json') {
    const feed = feedMode === 'current'
    ? currentFeed
    : feedMode === 'bad'
      ? badFeed
      : feedMode === 'nohash'
        ? noHashFeed
        : feedMode === 'hang' ? hangFeed : availableFeed
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(feed))
    return
  }
  if (url.pathname === '/payload') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(payload.length) })
    res.end(payload)
    return
  }
  if (url.pathname === '/hang') {
    return
  }
  if (req.url === '/api/host.describe' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ result: { ok: true } }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><html><head><title>Updater Fixture</title></head><body>'
    + '<div role="dialog"><div class="content"><div class="navList"><button class="active">通用设置</button></div>'
    + '<div class="options"><div><p>fixture setting</p></div></div></div></div></body></html>')
})
await new Promise((resolve, reject) => {
  fixture.once('error', reject)
  fixture.listen(0, '127.0.0.1', resolve)
})
const address = fixture.address()
if (typeof address !== 'object' || address === null) throw new Error('fixture server did not bind')
const origin = 'http://127.0.0.1:' + String(address.port)
availableFeed.platforms[currentKey].url = origin + '/payload'
currentFeed.platforms[currentKey].url = origin + '/payload'
badFeed.platforms[currentKey].url = origin + '/payload'
noHashFeed.platforms[currentKey].url = origin + '/payload'
hangFeed.platforms[currentKey].url = origin + '/hang'

const launchApp = async (home, extraEnv = {}) => {
  const electronEnv = { ...process.env, ...extraEnv }
  Reflect.deleteProperty(electronEnv, 'ELECTRON_RUN_AS_NODE')
  electronEnv.DSH_HOME = join(home, 'dsh')
  electronEnv.DSH_DESKTOP_HOME = join(home, 'desktop')
  electronEnv.DSH_DESKTOP_SKIP_PROBE = '1'
  electronEnv.DSH_DESKTOP_SKIP_INSTALLED_DSH = '1'
  electronEnv.DSH_DESKTOP_UPDATE_FEED = origin + '/latest.json'
  electronEnv.DSH_DESKTOP_UPDATE_GITHUB_API = ''
  electronEnv.DSH_DESKTOP_SKIP_UPDATE_CHECK = '1'
  electronEnv.DSH_DESKTOP_SKIP_UPDATE_PROMPT = '1'
  electronEnv.DSH_DESKTOP_UPDATE_DRY_RUN = '1'
  mkdirSync(join(home, 'desktop'), { recursive: true })
  writeFileSync(join(home, 'desktop', 'settings.json'), JSON.stringify({ serverUrl: origin }, null, 2) + '\n')
  const launched = await electron.launch({
    args: [join(APP_DIR, '.build', 'main.mjs'), '--user-data-dir=' + join(home, 'chromium')],
    env: electronEnv,
  })
  const window = await launched.firstWindow()
  await window.waitForFunction(() => document.title === 'Updater Fixture', null, { timeout: 15_000 })
  return { app: launched, window }
}

try {
  const availableHome = join(work, 'available')
  const available = await launchApp(availableHome)
  await available.window.locator('#dsh-desktop-update').waitFor({ state: 'visible', timeout: 3_000 })
  const before = await available.window.evaluate(() => window.desktop.update.getStatus())
  if (before.currentVersion !== desktopVersion) {
    throw new Error('status currentVersion: ' + JSON.stringify(before))
  }
  const checked = await available.window.evaluate(() => window.desktop.update.check())
  if (!checked.hasUpdate || checked.info.availableVersion !== '99.0.0' || checked.info.notes !== 'fixture changelog') {
    throw new Error('check did not report fixture update: ' + JSON.stringify(checked))
  }
  const installed = await available.window.evaluate(() => window.desktop.update.install())
  if (!installed.started) throw new Error('dry-run install failed: ' + JSON.stringify(installed))
  await available.window.evaluate(() => window.desktop.update.dismiss())
  const dismissed = JSON.parse(readFileSync(join(availableHome, 'desktop', 'settings.json'), 'utf8'))
  if (dismissed.updateDismissedVersion !== '99.0.0') {
    throw new Error('dismiss was not persisted: ' + JSON.stringify(dismissed))
  }
  await available.app.close()
  console.log('✓ official settings card exposes the updater')
  console.log('✓ check reports an available version from latest.json')
  console.log('✓ dry-run download verifies SHA-256')
  console.log('✓ dismissed version is persisted')

  feedMode = 'current'
  const currentHome = join(work, 'current')
  const current = await launchApp(currentHome)
  const upToDate = await current.window.evaluate(() => window.desktop.update.check())
  if (upToDate.hasUpdate) throw new Error('same version should be up to date: ' + JSON.stringify(upToDate))
  const currentState = await current.window.evaluate(() => window.desktop.update.getStatus())
  if (currentState.phase !== 'upToDate') throw new Error('expected upToDate, got ' + JSON.stringify(currentState))
  await current.app.close()
  console.log('✓ same-version feed is treated as up to date')

  feedMode = 'bad'
  const badHome = join(work, 'bad')
  const bad = await launchApp(badHome)
  const badCheck = await bad.window.evaluate(() => window.desktop.update.check())
  if (!badCheck.hasUpdate) throw new Error('bad-hash feed should still be available: ' + JSON.stringify(badCheck))
  const badInstall = await bad.window.evaluate(() => window.desktop.update.install())
  if (badInstall.started || !String(badInstall.error ?? '').includes('SHA-256')) {
    throw new Error('expected SHA-256 failure: ' + JSON.stringify(badInstall))
  }
  await bad.app.close()
  console.log('✓ install refuses a payload whose SHA-256 does not match')

  feedMode = 'nohash'
  const noHashHome = join(work, 'nohash')
  const noHash = await launchApp(noHashHome)
  const noHashCheck = await noHash.window.evaluate(() => window.desktop.update.check())
  if (!noHashCheck.hasUpdate) throw new Error('no-hash feed should still be available: ' + JSON.stringify(noHashCheck))
  const noHashInstall = await noHash.window.evaluate(() => window.desktop.update.install())
  if (noHashInstall.started || !String(noHashInstall.error ?? '').includes('SHA-256')) {
    throw new Error('expected missing SHA-256 refusal: ' + JSON.stringify(noHashInstall))
  }
  await noHash.app.close()
  console.log('✓ install refuses a payload that has no SHA-256')

  feedMode = 'hang'
  const hangHome = join(work, 'hang')
  const hang = await launchApp(hangHome, { DSH_DESKTOP_UPDATE_DOWNLOAD_IDLE_MS: '400' })
  const hangCheck = await hang.window.evaluate(() => window.desktop.update.check())
  if (!hangCheck.hasUpdate) throw new Error('hang feed should still be available: ' + JSON.stringify(hangCheck))
  const hangInstall = await hang.window.evaluate(() => window.desktop.update.install())
  if (hangInstall.started || !String(hangInstall.error ?? '').includes('超时')) {
    throw new Error('expected download timeout: ' + JSON.stringify(hangInstall))
  }
  await hang.app.close()
  console.log('✓ a stalled download times out and unlocks the updater')
} finally {
  await new Promise((resolve) => fixture.close(resolve))
  rmSync(work, { recursive: true, force: true })
}
