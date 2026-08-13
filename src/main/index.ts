/**
 * Electron main process for the DeepSeek Harness desktop client.
 *
 * The client consumes ONLY the public interface of the official dsh Web UI:
 * it manages a local `dsh web` child (or connects to a configured Web UI
 * origin) and loads the **official Web UI** itself in the client window — the
 * interface, session titles/renaming, and every button interaction are the
 * official product's, by construction. The client's own surface is limited to
 * a small connection-settings window (menu → "Web UI 连接…") served by a
 * minimal loopback server. Nothing here imports a harness package.
 *
 * Path expressions resolve at runtime from the BUILT bundle
 * (.build/main.mjs), so relative URLs are written against that layout, not
 * the source tree.
 * @module dsh-desktop/main
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { homedir, userInfo } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron'

/** The built bundle sits at <project>/.build/main.mjs. */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url))

/** The client's own data home (connection settings only). */
function clientHome(): string {
  return process.env.DSH_DESKTOP_HOME ?? join(homedir(), '.dsh-desktop')
}

/**
 * The local child's data home: the OFFICIAL dsh home, shared with the dsh
 * CLI and the browser Web UI — existing conversations, titles, credentials,
 * and model configuration are the same everywhere. DSH_HOME overrides.
 */
function childHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** The client's own settings document (connection configuration). */
const SETTINGS_FILE = join(clientHome(), 'settings.json')

interface ClientSettings {
  /** Empty/absent = launch the local `dsh web`; otherwise the Web UI origin to connect to. */
  serverUrl?: string
}

function loadSettings(): ClientSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as ClientSettings
  } catch {
    return {}
  }
}

function saveSettings(settings: ClientSettings): void {
  mkdirSync(clientHome(), { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n')
}

/** Normalize a user-supplied Web UI address to an origin, or undefined when blank/invalid. */
function normalizeServerUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  let candidate = value.trim()
  if (!/^https?:\/\//.test(candidate)) candidate = 'http://' + candidate
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * The Node that runs the dsh child. Inside a packaged app the child runs on
 * Electron's own bundled Node (ELECTRON_RUN_AS_NODE), so the end user needs
 * neither a system Node nor any npm command; in development the system Node
 * (or DSH_DESKTOP_NODE) is used.
 */
function nodeForChild(): string {
  if (app.isPackaged) return process.execPath
  return process.env.DSH_DESKTOP_NODE ?? 'node'
}

/**
 * macOS GUI applications inherit launchd's small PATH instead of the user's
 * login-shell PATH. The official runtime later derives Agent command
 * environments from this process, so Homebrew and version-manager tools would
 * otherwise disappear only in the packaged app. Read one PATH value through
 * the user's absolute login shell, with a short deadline and no interactive
 * startup, then merge only absolute path entries into the existing value.
 */
async function restoreMacGuiPath(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged || process.env.DSH_DESKTOP_SKIP_LOGIN_PATH === '1') return

  const configuredShell = userInfo().shell
  const shellPath = typeof configuredShell === 'string' && isAbsolute(configuredShell) && existsSync(configuredShell)
    ? configuredShell
    : '/bin/zsh'
  const loginPath = await new Promise<string | undefined>((resolve) => {
    let settled = false
    let stdout = ''
    const finish = (value?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const child = spawn(shellPath, ['-l', '-c', 'printf \'\\0%s\\0\' "$PATH"'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const timeout = setTimeout(() => {
      child.kill()
      finish()
    }, 3_000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > 65_536) stdout = stdout.slice(-65_536)
    })
    child.once('error', () => { finish() })
    child.once('exit', (code) => {
      const end = stdout.lastIndexOf('\0')
      const start = end > 0 ? stdout.lastIndexOf('\0', end - 1) : -1
      finish(code === 0 && start >= 0 && end > start ? stdout.slice(start + 1, end) : undefined)
    })
  })

  // Shells that model PATH as a list (fish) join it with spaces rather than the
  // path delimiter, which yields one long pseudo-absolute entry. Requiring the
  // directory to exist drops that value instead of prepending a bogus entry.
  const fromLogin = (loginPath ?? '').split(delimiter)
    .map(entry => entry.trim())
    .filter(entry => entry !== '' && isAbsolute(entry) && existsSync(entry))
  const fromLaunch = (process.env.PATH ?? '').split(delimiter)
    .map(entry => entry.trim())
    .filter(entry => entry !== '' && isAbsolute(entry))
  const merged = [...new Set([...fromLogin, ...fromLaunch])].join(delimiter)
  if (merged === '') {
    console.warn('[desktop] login-shell PATH unavailable; keeping the launch environment')
    return
  }
  process.env.PATH = merged
  console.log('[desktop] restored PATH from the macOS login shell')
}

/**
 * The bundled dsh CLI. Release builds use pnpm deploy to materialize the
 * complete production closure outside app.asar; development resolves the same
 * pinned package from the dsh-runtime workspace. An end user needs neither a
 * system Node nor a separately installed dsh command.
 */
function resolveBundledDsh(): DshCommand | undefined {
  try {
    const bin = app.isPackaged
      ? join(process.resourcesPath, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      : createRequire(join(APP_DIR, 'dsh-runtime', 'package.json')).resolve('@deepseek-ai/dsh/lib/bin.js')
    if (!existsSync(bin)) return undefined
    return {
      command: nodeForChild(),
      // System Node can use node-addon-require-builtin, but Electron's Node
      // mode does not expose the loader required by cordis-plugin-hmr through
      // that addon and exits with "--expose-internals is required". Keep the
      // unstable flag scoped to the packaged child; source audit and package
      // smoke intentionally cover both execution paths.
      args: [...app.isPackaged ? ['--expose-internals'] : [], bin],
      binPath: bin,
      label: bin,
      source: 'bundled',
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve the `dsh` command the client spawns for local mode. Order: the
 * explicit DSH_DESKTOP_DSH override, the app-bundled npm package, conventional
 * sibling checkouts (dev convenience), and finally `dsh` on PATH.
 */
interface DshCommand {
  command: string
  args: string[]
  binPath?: string
  label: string
  source: 'override' | 'bundled' | 'checkout' | 'path'
}

class BundledRuntimeMissingError extends Error {
  constructor() {
    super('安装包中缺少内置 dsh 运行时。请重新从项目的 GitHub Releases 下载并安装完整客户端。')
    this.name = 'BundledRuntimeMissingError'
  }
}

function resolveDshCommand(): DshCommand {
  const explicit = process.env.DSH_DESKTOP_DSH
  if (explicit !== undefined && explicit.trim() !== '') {
    return { command: explicit, args: [], label: explicit, source: 'override' }
  }
  const bundled = resolveBundledDsh()
  if (bundled !== undefined) return bundled
  // A release artifact is self-contained by contract. Falling through to a
  // PATH lookup hides packaging damage behind several guaranteed ENOENT
  // retries on an ordinary user's machine.
  if (app.isPackaged) throw new BundledRuntimeMissingError()
  // Dev convenience: probe sibling checkouts (read-only; never a package dependency).
  const siblings = fileURLToPath(new URL('../..', import.meta.url))
  for (const name of ['test-bruc3van', 'deepseek-harness']) {
    const bin = join(siblings, name, 'apps', 'cli', 'lib', 'bin.js')
    if (existsSync(bin)) {
      const node = process.env.DSH_DESKTOP_NODE ?? 'node'
      return { command: node, args: [bin], binPath: bin, label: bin, source: 'checkout' }
    }
  }
  return { command: 'dsh', args: [], label: 'dsh', source: 'path' }
}

/** Parse the readiness line the official Web app prints once the server binds. */
function parseReadiness(line: string): string | undefined {
  const match = /^dsh web:\s+(\S+)/.exec(line)
  return match?.[1]
}

/** One `dsh web` child generation: process + its own lifecycle listeners. */
interface WebUiGeneration {
  child: ChildProcess
  /** Settles with the Web UI URL when THIS generation reports readiness. */
  ready: Promise<string>
  /** Whether THIS generation reached readiness before it exited. */
  readyReported: boolean
}

/**
 * The local `dsh web` runtime manager: spawn generations on demand, resolve
 * the served URL once, report every exit through one callback so the window
 * owner can decide relaunch vs. fatal.
 */
class WebUiManager {
  private generation: WebUiGeneration | undefined
  /** A stop in flight must finish before another generation can be spawned. */
  private stopping: Promise<void> | undefined
  /**
   * A failure no relaunch can repair (a damaged installation). It is reported
   * through onExit exactly once; later readiness requests reject with it
   * instead of spawning again, so the user never collects a stack of identical
   * error dialogs by reopening the window.
   */
  private fatalError: Error | undefined
  lastError: string | null = null

  constructor(
    private readonly onLog: (line: string) => void,
    private readonly onExit: (info: { wasReady: boolean; code: number | null; signal: NodeJS.Signals | null; retryable: boolean }) => void,
  ) {}

  /** The current generation's readiness, or a fresh spawn when none exists. */
  async ready(): Promise<string> {
    await this.stopping
    if (this.fatalError !== undefined) throw this.fatalError
    const gen = this.generation
    if (gen !== undefined) return gen.ready
    this.spawn()
    const spawned = this.generation
    if (spawned === undefined) return Promise.reject(new Error('dsh web spawn failed'))
    return spawned.ready
  }

  /** The current child's pid, when one is running. */
  pid(): number | undefined {
    const gen = this.generation
    return gen?.child.pid
  }

  spawn(): void {
    if (this.fatalError !== undefined) return
    mkdirSync(childHome(), { recursive: true })
    let dsh: DshCommand
    try {
      dsh = resolveDshCommand()
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.fatalError = failure
      this.lastError = failure.message
      queueMicrotask(() => {
        this.onExit({ wasReady: false, code: null, signal: null, retryable: false })
      })
      return
    }
    console.log('[desktop] dsh runtime: ' + dsh.source + ' (' + dsh.label + ')')
    const child = spawn(dsh.command, [...dsh.args, 'web', '--port', '0'], {
      cwd: childHome(),
      env: {
        ...process.env,
        DSH_HOME: childHome(),
        // Inside a packaged app the child runs on Electron's bundled Node.
        ...app.isPackaged && { ELECTRON_RUN_AS_NODE: '1' },
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let resolveReady: (url: string) => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const gen: WebUiGeneration = { child, ready, readyReported: false }
    let exitReported = false
    let readinessProbeStarted = false

    const reportExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (exitReported) return
      exitReported = true
      if (this.generation === gen) this.generation = undefined
      this.onExit({ wasReady: gen.readyReported, code, signal, retryable: true })
    }

    // Line framing across chunk boundaries: a readiness line split by the
    // pipe must not be lost (or misparsed).
    let stdoutBuffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() === '') continue
        this.onLog(line)
        const url = parseReadiness(line)
        if (url !== undefined && !readinessProbeStarted) {
          readinessProbeStarted = true
          void waitForWebUiReady(url).then(() => {
            if (exitReported) return
            gen.readyReported = true
            this.lastError = null
            resolveReady(url)
          }, (error: unknown) => {
            if (exitReported) return
            this.lastError = error instanceof Error ? error.message : String(error)
            rejectReady(error instanceof Error ? error : new Error(String(error)))
            child.kill()
          })
        }
      }
    })
    child.on('close', () => {
      if (stdoutBuffer.trim() !== '') this.onLog(stdoutBuffer)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write('[dsh web] ' + chunk.toString())
    })
    child.on('error', (error) => {
      this.lastError = error.message
      rejectReady(error)
      reportExit(null, null)
    })
    child.on('exit', (code, signal) => {
      rejectReady(new Error('dsh web exited before ready (code=' + String(code) + ')'))
      reportExit(code, signal)
    })
    this.generation = gen
  }

  /**
   * Stop the current generation. On POSIX the SIGTERM → SIGKILL ladder gives
   * the harness its graceful disposal window; on Windows signals cannot be
   * caught, so the whole process tree is terminated (taskkill /T /F).
   */
  async stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    const gen = this.generation
    if (gen === undefined || gen.child.exitCode !== null) return
    const stopping = (async (): Promise<void> => {
      if (process.platform === 'win32') {
        const pid = gen.child.pid
        if (pid === undefined) return
        gen.child.kill()
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { resolve() }, 3000)
          gen.child.once('exit', () => { clearTimeout(timer); resolve() })
          // Kill the tree (the harness spawns shell children that would
          // otherwise outlive the direct child).
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {})
        })
        return
      }
      gen.child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { gen.child.kill('SIGKILL'); resolve() }, 3000)
        gen.child.once('exit', () => { clearTimeout(timer); resolve() })
      })
    })()
    this.stopping = stopping
    try {
      await stopping
    } finally {
      if (this.stopping === stopping) this.stopping = undefined
    }
  }
}

let mainWindow: BrowserWindow | null = null
/** Whether a caller is waiting for the main window, as opposed to tray-only recovery. */
let mainWindowRequested = false
/** Whether the main window still shows the local loading document. */
let loadingDocumentActive = false
let settingsWindow: BrowserWindow | null = null
let settingsServerPort = 0
/** Bearer-like unguessable path: loopback binding alone is not authorization. */
const settingsServerPath = '/' + randomBytes(24).toString('hex') + '/'
let tray: Tray | null = null
let webUi: WebUiManager | undefined
const MAX_LAUNCH_RETRIES = 3
const INITIAL_RELAUNCH_DELAY_MS = 250
let launchBudget = MAX_LAUNCH_RETRIES
let quitting = false
/** Monotonic connection intent; stale probes/readiness callbacks cannot win. */
let connectionGeneration = 0
/** Avoid concurrent health probes and reload loops after sleep/wake churn. */
let windowRecoveryInFlight = false
let lastAutomaticReloadAt = 0
let windowHealthTimer: NodeJS.Timeout | undefined
const AUTOMATIC_RELOAD_COOLDOWN_MS = 30_000
const WINDOW_HEALTH_INTERVAL_MS = 60_000

/** Exponential delay derived from the number of retries already consumed. */
function relaunchDelayMs(remainingRetries: number): number {
  const attemptsConsumed = MAX_LAUNCH_RETRIES - remainingRetries
  return INITIAL_RELAUNCH_DELAY_MS * 2 ** Math.max(0, attemptsConsumed - 1)
}

/**
 * The official Web UI's default port. In smart mode (no explicit address) the
 * client first probes a locally running official instance on this port and
 * connects to it — the window and the browser then share ONE harness process,
 * so conversations (like the live one in the browser) sync in real time. Only
 * when nothing answers does the client launch its own local `dsh web`.
 */
const DEFAULT_WEB_PROBE_URL = 'http://127.0.0.1:3080'

/** The current Web UI origin: the probed/configured address, or the local child's URL. */
let configuredTarget: string | undefined
/** True when configuredTarget came from the startup probe (not the settings). */
let probeConnected = false
let childTarget: string | undefined

function currentTarget(): string | undefined {
  return configuredTarget ?? childTarget
}

/**
 * Probe one Web UI origin: a plain non-browser /api call (no browser markers,
 * so the trust fence passes over loopback). Returns the origin when a real
 * harness answers host.describe, undefined otherwise.
 */
async function probeWebUi(base: string, timeoutMs = 1_500): Promise<string | undefined> {
  try {
    const response = await fetch(base + '/api/host.describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'desktop-probe', method: 'host.describe', payload: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { result?: { ok?: boolean } }
    if (body.result?.ok !== true) return undefined
    return new URL(base).origin
  } catch {
    return undefined
  }
}

/** Allow binding and API initialization up to 10 seconds after the log line. */
async function waitForWebUiReady(base: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await probeWebUi(base, 300) !== undefined) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('dsh web reported readiness but did not accept API requests')
}

/** Open external links in the system browser; never in a client window. */
function openExternal(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
}

/** The official Web UI origin (the window must stay inside it). */
function appOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** The official UI always renders visible text; an empty body after settling is a blank renderer. */
async function hasVisiblePageContent(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isLoadingMainFrame()) return true
  try {
    return await window.webContents.executeJavaScript(`(() => {
      const body = document.body
      if (document.readyState !== 'complete' || body === null) return true
      const rect = body.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && (body.innerText || '').trim().length > 0
    })()`, true) as boolean
  } catch {
    return false
  }
}

/**
 * Recover a renderer that went blank after a long idle or system resume.
 * Two DOM samples avoid reloading a page during a normal React transition;
 * the runtime probe prevents turning a temporary server outage into a loop.
 */
async function recoverBlankWindow(reason: string, force = false): Promise<void> {
  const window = mainWindow
  const target = currentTarget()
  if (window === null || target === undefined || window.isDestroyed() || quitting || windowRecoveryInFlight) return
  if (Date.now() - lastAutomaticReloadAt < AUTOMATIC_RELOAD_COOLDOWN_MS) return
  if (!force && (window.isMinimized() || !window.isVisible())) return

  windowRecoveryInFlight = true
  try {
    if (!force && await hasVisiblePageContent(window)) return
    if (!force) {
      await new Promise(resolve => setTimeout(resolve, 2_000))
      if (window !== mainWindow || await hasVisiblePageContent(window)) return
    }
    if (await probeWebUi(target) === undefined || window !== mainWindow || window.isDestroyed()) return

    lastAutomaticReloadAt = Date.now()
    console.warn('[desktop] reloading blank Web UI (' + reason + ')')
    window.webContents.reload()
  } finally {
    windowRecoveryInFlight = false
  }
}

/** Check only a visible window; hidden tray sessions must not be refreshed in the background. */
function scheduleWindowHealthCheck(reason: string, delayMs = 1_000): void {
  setTimeout(() => { void recoverBlankWindow(reason) }, delayMs).unref()
}

/** The official DeepSeek Harness logo: rounded-corner dark tile with the white glyph. */
const ICON_PNG = join(APP_DIR, 'resources', 'icon-app.png')

/**
 * The logo as an inline data URI, or an empty tag when the resource cannot be
 * read: the first window is now on the startup path, so a missing icon must
 * degrade to a plain loading page rather than abort the launch.
 */
function loadingIconTag(): string {
  try {
    return '<img class="mark" alt="" src="data:image/png;base64,' + readFileSync(ICON_PNG).toString('base64') + '">'
  } catch (error) {
    console.warn('[desktop] loading icon unavailable:', error instanceof Error ? error.message : String(error))
    return ''
  }
}

/** The small first-paint surface shown while Smart mode resolves the Web UI. */
function loadingPageUrl(): string {
  const chinese = app.getLocale().toLowerCase().startsWith('zh')
  const title = chinese ? '正在启动 DeepSeek Harness' : 'Starting DeepSeek Harness'
  const detail = chinese ? '正在准备本地服务…' : 'Preparing the local service…'
  const hint = chinese ? '首次启动可能需要几秒钟' : 'The first launch may take a few seconds'
  const html = '<!doctype html><html lang="' + (chinese ? 'zh-CN' : 'en') + '"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">'
    + '<meta name="color-scheme" content="light dark"><title>' + title + '</title><style>'
    + ':root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}'
    + '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#0f1115}'
    + 'main{width:min(360px,calc(100vw - 48px));text-align:center}.mark{width:64px;height:64px;border-radius:16px;box-shadow:0 12px 32px rgba(15,17,21,.14)}'
    + 'h1{margin:22px 0 8px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em}'
    + '#loading-status{margin:0;color:#6e7480;font-size:14px;line-height:22px}.hint{margin:8px 0 0;color:#9aa0a6;font-size:12px;line-height:18px}'
    + '.activity{height:20px;margin:20px auto 0;display:flex;justify-content:center;align-items:center;gap:6px}'
    // An author rule beats the UA stylesheet, so [hidden] needs restating here.
    + '.activity[hidden],.hint[hidden]{display:none}'
    + '.activity i{display:block;width:5px;height:5px;border-radius:50%;background:#0f1115;animation:pulse 1.2s ease-in-out infinite}'
    + '.activity i:nth-child(2){animation-delay:.16s}.activity i:nth-child(3){animation-delay:.32s}'
    + '@keyframes pulse{0%,70%,100%{opacity:.18;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}'
    + '@media(prefers-color-scheme:dark){body{background:#17181a;color:#f4f5f6}.mark{box-shadow:0 12px 32px rgba(0,0,0,.34)}#loading-status{color:#aeb3bb}.hint{color:#818791}.activity i{background:#f4f5f6}}'
    + '@media(prefers-reduced-motion:reduce){.activity i{animation:none}.activity i:nth-child(2){opacity:.5}.activity i:nth-child(3){opacity:.8}}'
    + '</style></head><body><main>' + loadingIconTag()
    + '<h1>' + title + '</h1><p id="loading-status">' + detail + '</p><p class="hint">' + hint + '</p>'
    + '<div class="activity" aria-hidden="true"><i></i><i></i><i></i></div></main></body></html>'
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/**
 * Update the loading document's status line. The 'failed' state also withdraws
 * the activity indicator and the "may take a few seconds" hint: a launch that
 * cannot proceed must not keep animating, nor keep promising progress.
 */
function updateLoadingStatus(chinese: string, english: string, state: 'busy' | 'failed' = 'busy'): void {
  const window = mainWindow
  // Not webContents.getURL(): it stays empty until the data document commits,
  // which is exactly when the first status update is issued. Electron holds
  // the script until the page stops loading, so an early call still lands.
  if (!loadingDocumentActive || window === null || window.isDestroyed() || window.webContents.isDestroyed()) return
  const message = app.getLocale().toLowerCase().startsWith('zh') ? chinese : english
  const failed = String(state === 'failed')
  void window.webContents.executeJavaScript(
    `document.getElementById('loading-status')?.replaceChildren(${JSON.stringify(message)});`
    + `document.querySelector('.activity')?.toggleAttribute('hidden', ${failed});`
    + `document.querySelector('.hint')?.toggleAttribute('hidden', ${failed});`,
    true,
  ).catch(() => {})
}

/** Create the client window immediately; the official Web UI replaces its loading surface when ready. */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Harness',
    backgroundColor: '#FFFFFF',
    // The official Web UI carries its own header; a hiddenInset title bar
    // would overlap it. The standard title bar keeps the traffic lights away
    // from the page on macOS and renders the official icon on Windows/Linux.
    titleBarStyle: 'default',
    icon: ICON_PNG,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: ['--dsh-username=' + userInfo().username],
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  mainWindow.once('ready-to-show', () => { mainWindow?.show() })
  mainWindow.on('show', () => { scheduleWindowHealthCheck('window shown') })
  mainWindow.on('focus', () => { scheduleWindowHealthCheck('window focused') })
  mainWindow.on('closed', () => {
    mainWindow = null
    mainWindowRequested = false
    loadingDocumentActive = false
  })
  // The official Web UI is loaded; anything it tries to open elsewhere goes
  // to the system browser, and no new windows exist.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const allowedTarget = currentTarget()
    if (allowedTarget !== undefined && appOrigin(targetUrl) !== appOrigin(allowedTarget)) {
      event.preventDefault()
      openExternal(targetUrl)
    }
  })
  // An unreachable Web UI (connect mode) must not strand the user: offer
  // retry or the connection-settings window.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || quitting || code === -3 || failedUrl.startsWith('data:')) return // -3 = ERR_ABORTED
    void dialog.showMessageBox(mainWindow as BrowserWindow, {
      type: 'error',
      title: 'Harness',
      message: '无法加载 Web UI',
      detail: failedUrl + '\n' + String(code) + ': ' + description,
      buttons: ['重试', '连接设置…', '退出'],
    }).then(({ response }) => {
      if (response === 0) void mainWindow?.webContents.reload()
      else if (response === 1) openSettingsWindow()
      else app.quit()
    })
  })
  // Chromium may lose its renderer after sleep or resource pressure without a
  // did-fail-load event. Reloading the surviving Web UI origin recreates it.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[desktop] renderer process gone:', details.reason, details.exitCode)
    void recoverBlankWindow('renderer ' + details.reason, true)
  })
  let rendererUnresponsive = false
  mainWindow.on('unresponsive', () => {
    rendererUnresponsive = true
    setTimeout(() => {
      if (rendererUnresponsive) void recoverBlankWindow('renderer unresponsive', true)
    }, 30_000).unref()
  })
  mainWindow.on('responsive', () => { rendererUnresponsive = false })
  loadingDocumentActive = true
  void mainWindow.loadURL(loadingPageUrl()).catch(() => {})
}

/** Navigate the existing loading/client window to one official Web UI origin. */
function loadMainWindow(url: string): void {
  if (mainWindow === null) createWindow()
  if (mainWindow === null || appOrigin(mainWindow.webContents.getURL()) === appOrigin(url)) return
  loadingDocumentActive = false
  void mainWindow.loadURL(url).catch(() => { /* did-fail-load owns user recovery */ })
}

/** The small connection-settings window (menu → "Web UI 连接…"). */
function openSettingsWindow(): void {
  if (settingsWindow !== null) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 320,
    title: 'Web UI 连接',
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  settingsWindow.on('closed', () => { settingsWindow = null })
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  settingsWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const allowed = 'http://127.0.0.1:' + String(settingsServerPort) + settingsServerPath
    if (!targetUrl.startsWith(allowed)) event.preventDefault()
  })
  void settingsWindow.loadURL('http://127.0.0.1:' + String(settingsServerPort) + settingsServerPath)
}

/**
 * The tray (menu-bar) seat: closing the window keeps the client running.
 * macOS convention: left-click reopens the window, right-click shows the
 * menu; Windows/Linux show the menu on left-click (platform default).
 */
function createTray(): void {
  const icon = nativeImage.createFromPath(join(APP_DIR, 'resources', 'iconMenuTemplate.png'))
  if (icon.isEmpty()) return
  tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness')
  const showMain = (): void => {
    if (mainWindow === null) {
      launchWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMain },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } },
  ])
  if (process.platform === 'darwin') {
    tray.on('click', showMain)
    tray.on('right-click', () => { tray?.popUpContextMenu(menu) })
  } else {
    tray.setContextMenu(menu)
  }
}

/** The connection facts shared by the settings server and the IPC bridge. */
function getStatusJson(): Record<string, unknown> {
  return {
    mode: probeConnected ? 'probe' : configuredTarget !== undefined ? 'connect' : 'local',
    targetUrl: currentTarget() ?? '',
    desktopVersion: desktopClientVersion(),
    dshVersion: bundledDshVersion(),
    ...webUi?.pid() !== undefined && { childPid: webUi.pid() },
    ...webUi?.lastError !== null && webUi?.lastError !== undefined && { lastError: webUi.lastError },
  }
}

let cachedDesktopVersion: string | undefined

/** The desktop shell version is independent from Electron and dsh versions. */
function desktopClientVersion(): string {
  if (cachedDesktopVersion !== undefined) return cachedDesktopVersion
  try {
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as { version?: unknown }
    cachedDesktopVersion = typeof manifest.version === 'string' ? manifest.version : app.getVersion()
  } catch {
    cachedDesktopVersion = app.getVersion()
  }
  return cachedDesktopVersion
}

let cachedBundledDshVersion: string | null | undefined

/** Version of the official runtime shipped with this desktop release. */
function bundledDshVersion(): string | null {
  if (cachedBundledDshVersion !== undefined) return cachedBundledDshVersion
  const bin = resolveBundledDsh()?.binPath
  if (bin === undefined) return (cachedBundledDshVersion = null)
  try {
    const manifest = JSON.parse(readFileSync(join(bin, '..', '..', 'package.json'), 'utf8')) as { version?: unknown }
    cachedBundledDshVersion = typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    cachedBundledDshVersion = null
  }
  return cachedBundledDshVersion
}

/** Behavior for the loopback connection-settings page, served under the same origin. */
const SETTINGS_PAGE_SCRIPT = 'const $ = id => document.getElementById(id);'
  + 'async function refresh(){try{const s=await(await fetch("desktop/status")).json();'
  + 'const modeLabel=s.mode==="probe"?"已连接本机正在运行的官方实例":s.mode==="connect"?"连接":"本地 dsh web";'
  + '$("status").textContent=modeLabel+(s.childPid?" (PID "+s.childPid+")":"")+" → "+(s.targetUrl||"（未就绪）")+(s.lastError?" · "+s.lastError:"");'
  + '$("versions").textContent="桌面客户端 v"+s.desktopVersion+" · 内置 dsh "+(s.dshVersion??"不可用");'
  + 'const c=await(await fetch("desktop/settings")).json();$("url").value=c.serverUrl??"";}catch(e){$("status").textContent="状态不可用"}}'
  + '$("save").onclick=async()=>{try{const r=await fetch("desktop/settings",{method:"POST",headers:{"content-type":"application/json"},'
  + 'body:JSON.stringify({serverUrl:$("url").value.trim()})});const j=await r.json();'
  + '$("note").textContent=j.saved?"已保存，正在重连…":("保存失败："+(j.error||"未知错误"));'
  + 'if(j.saved)setTimeout(()=>window.close(),900)}catch(e){$("note").textContent="保存失败："+e.message}};'
  + '$("close").onclick=()=>window.close();refresh();'

/** The connection-settings page (self-contained except for its same-origin script). */
function settingsPageHtml(): string {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>Web UI 连接</title>'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'unsafe-inline\'">'
    + '<style>body{font:14px -apple-system,"PingFang SC",sans-serif;margin:24px;color:#242424}'
    + 'h1{font-size:16px;margin:0 0 12px}p{color:#666;margin:8px 0}label{display:block;margin:10px 0 4px;font-size:13px;color:#666}'
    + 'input{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d8d8d4;border-radius:8px;font:inherit}'
    + 'button{margin-top:14px;padding:7px 14px;border:1px solid #d8d8d4;border-radius:8px;background:#fff;font:inherit;cursor:pointer}'
    + 'button.primary{background:#1c1c1c;color:#fff;border-color:#1c1c1c;margin-right:8px}</style></head><body>'
    + '<h1>Web UI 连接</h1>'
    + '<p id="status">读取状态…</p>'
    + '<p id="versions"></p>'
    + '<label for="url">Web UI 地址（留空 = 本地启动 dsh）</label>'
    + '<input id="url" placeholder="http://127.0.0.1:3080" spellcheck="false">'
    + '<div><button id="save" class="primary">保存并重连</button><button id="close">关闭</button></div>'
    + '<p id="note"></p>'
    + '<script src="desktop/settings.js"></script></body></html>'
}

/** Connect to a fixed Web UI origin: stop any local child, point the window at it. */
function connectTo(url: string): void {
  const generation = ++connectionGeneration
  configuredTarget = url
  probeConnected = false
  childTarget = undefined
  if (webUi !== undefined) void webUi.stop()
  launchWindow(generation)
}

/** Use the local `dsh web` child (spawned on demand, awaited via readiness). */
function startLocalRuntime(generation: number): void {
  if (generation !== connectionGeneration || quitting) return
  configuredTarget = undefined
  probeConnected = false
  launchWindow(generation)
}

/** Smart mode: prefer a locally running official instance, else launch our own. */
function resolveRuntime(): void {
  const generation = ++connectionGeneration
  if (process.env.DSH_DESKTOP_SKIP_PROBE === '1') {
    startLocalRuntime(generation)
    return
  }
  void probeWebUi(DEFAULT_WEB_PROBE_URL).then((probed) => {
    if (quitting || generation !== connectionGeneration) return
    if (probed !== undefined) {
      configuredTarget = probed
      probeConnected = true
      childTarget = undefined
      if (webUi !== undefined) void webUi.stop()
      launchWindow(generation)
      return
    }
    startLocalRuntime(generation)
  })
}

/** Open the window at the CURRENT target, waiting for local readiness if needed. */
function launchWindow(generation = connectionGeneration): void {
  if (generation !== connectionGeneration || quitting) return
  mainWindowRequested = true
  if (mainWindow === null) createWindow()
  if (configuredTarget !== undefined) {
    updateLoadingStatus('正在连接 Web UI…', 'Connecting to the Web UI…')
    loadMainWindow(configuredTarget)
    return
  }
  updateLoadingStatus('正在启动本地 dsh 服务…', 'Starting the local dsh service…')
  void webUi?.ready().then((url) => {
    if (generation !== connectionGeneration || quitting) return
    console.log('[desktop] dsh runtime ready: ' + url)
    childTarget = url
    launchBudget = MAX_LAUNCH_RETRIES
    if (!mainWindowRequested) return
    if (configuredTarget === undefined) loadMainWindow(url)
  }, () => {
    // The first failure raised its dialog through onExit. A repeat request
    // (dock activate, second instance) rejects without one, so the loading
    // surface must carry the state instead of spinning forever.
    if (generation !== connectionGeneration || quitting) return
    updateLoadingStatus('本地服务启动失败。请从菜单打开「Web UI 连接…」。',
      'The local service failed to start. Open “Web UI connection…” from the menu.', 'failed')
  })
}

/** The application menu: standard roles plus the connection-settings seat. */
function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const connectionItem: Electron.MenuItemConstructorOptions = {
    label: 'Web UI 连接…',
    click: () => { openSettingsWindow() },
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        connectionItem,
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : [{
      label: '文件',
      submenu: [connectionItem, { type: 'separator' as const }, { role: 'quit' as const }],
    }],
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Start the private-path loopback settings server and resolve only once bound. */
function startSettingsServer(): Promise<number> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    if (!url.pathname.startsWith(settingsServerPath)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const pathname = '/' + url.pathname.slice(settingsServerPath.length)
    if (pathname === '/desktop/status') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(JSON.stringify(getStatusJson()))
      return
    }
    if (pathname === '/desktop/settings.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(SETTINGS_PAGE_SCRIPT)
      return
    }
    if (pathname === '/desktop/settings') {
      if (req.method === 'POST') {
        let body = ''
        let bodyTooLarge = false
        req.on('data', (chunk: Buffer) => {
          if (bodyTooLarge) return
          body += chunk.toString()
          if (body.length > 16_384) {
            bodyTooLarge = true
            res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ saved: false, error: 'request body too large' }))
          }
        })
        req.on('end', () => {
          if (bodyTooLarge) return
          try {
            const parsed = JSON.parse(body) as { serverUrl?: unknown }
            const next: ClientSettings = {
              ...typeof parsed.serverUrl === 'string' ? { serverUrl: parsed.serverUrl } : {},
            }
            saveSettings(next)
            const explicit = normalizeServerUrl(next.serverUrl)
            if (explicit !== undefined) {
              // Point the main window at the fixed address (stop the local child).
              connectTo(explicit)
            } else {
              // Back to smart mode: running official instance, or the local child.
              resolveRuntime()
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ saved: true }))
          } catch (error) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ saved: false, error: error instanceof Error ? error.message : String(error) }))
          }
        })
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(JSON.stringify(loadSettings()))
      return
    }
    if (pathname === '/' || pathname === '/desktop/settings.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(settingsPageHtml())
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      settingsServerPort = typeof address === 'object' && address !== null ? address.port : 0
      resolve(settingsServerPort)
    })
  })
}

function showLocalRuntimeStartupFailure(code: number | null, signal: NodeJS.Signals | null): void {
  const reason = webUi?.lastError
  updateLoadingStatus('本地服务启动失败。请从菜单打开「Web UI 连接…」。',
    'The local service failed to start. Open “Web UI connection…” from the menu.', 'failed')
  const options = {
    type: 'error' as const,
    title: 'Harness',
    message: '本地服务无法启动',
    detail: (reason !== null && reason !== undefined ? reason + '\n' : '')
      + '运行结果：' + String(code) + ' / ' + String(signal) + '。\n'
      + '请重新安装完整客户端，或在「Web UI 连接…」中填写另一个可用地址。',
    buttons: ['Web UI 连接…', '退出'],
    defaultId: 0,
    cancelId: 1,
  }
  const owner = mainWindow
  const result = owner === null ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options)
  void result.then(({ response }) => {
    if (response === 0) openSettingsWindow()
    else app.quit()
  })
}

function boot(): void {
  const settings = loadSettings()
  webUi = new WebUiManager(
    (line) => { console.log('[dsh web] ' + line) },
    ({ wasReady, code, signal, retryable }) => {
      if (quitting) return
      if (configuredTarget !== undefined) {
        // Connect/probe mode: a child exit is irrelevant (there should be none).
        return
      }
      childTarget = undefined
      if (!wasReady && retryable && launchBudget > 0) {
        launchBudget -= 1
        const delayMs = relaunchDelayMs(launchBudget)
        const generation = connectionGeneration
        console.error('[desktop] dsh web ' + (wasReady ? 'exited' : 'failed to start') + ' (' + String(code) + '/' + String(signal)
          + '); relaunching in ' + String(delayMs) + 'ms (' + String(launchBudget) + ' left)')
        setTimeout(() => {
          if (quitting || configuredTarget !== undefined || generation !== connectionGeneration) return
          updateLoadingStatus('本地服务启动失败，正在重试…', 'The local service did not start; retrying…')
          webUi?.spawn()
          if (mainWindowRequested) {
            launchWindow(generation)
            return
          }
          // Tray mode stays quiet, but still observes readiness/rejection so a
          // failed recovery consumes the shared retry budget without an
          // unhandled promise rejection.
          void webUi?.ready().then((url) => {
            if (quitting || configuredTarget !== undefined || generation !== connectionGeneration) return
            childTarget = url
            launchBudget = MAX_LAUNCH_RETRIES
          }, () => {})
        }, delayMs)
        return
      }
      if (!wasReady) {
        console.error('[desktop] dsh web failed to start (' + String(code) + '/' + String(signal) + '); no relaunches left')
        showLocalRuntimeStartupFailure(code, signal)
        return
      }
      // A live window lost its runtime: fatal.
      console.error('[desktop] dsh web exited (' + String(code) + '/' + String(signal) + ')')
      const options: Electron.MessageBoxOptions = {
        type: 'error',
        title: 'Harness',
        message: '运行时意外退出',
        detail: '代码 ' + String(code) + ' / 信号 ' + String(signal) + '。',
        buttons: ['退出'],
      }
      const owner = mainWindow
      const result = owner === null ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options)
      void result.then(() => { app.quit() })
    },
  )

  const explicit = normalizeServerUrl(settings.serverUrl)
  if (explicit !== undefined) {
    // Explicit address: fixed connection.
    connectTo(explicit)
    return
  }
  // Smart mode: probe a running official instance, else launch the local child.
  resolveRuntime()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) {
      launchWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    app.setName('DeepSeek Harness Desktop')
    // Packaged macOS builds use the bundle icon. Do not replace it at runtime
    // with the pre-masked PNG: macOS 26 adds its own enclosure around that
    // image and produces a visible double border. An unpackaged run has no
    // bundle icon at all, so there the PNG is still better than Electron's
    // default dock tile.
    if (process.platform === 'darwin' && !app.isPackaged) {
      const dockIcon = nativeImage.createFromPath(ICON_PNG)
      if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon)
    }
    // Paint immediately. Runtime probing/boot continues behind this one window
    // and replaces the loading document with the official Web UI when ready.
    mainWindowRequested = true
    createWindow()
    const guiPathReady = restoreMacGuiPath()
    await startSettingsServer()
    installMenu()
    createTray()
    powerMonitor.on('resume', () => { scheduleWindowHealthCheck('system resume', 3_000) })
    windowHealthTimer = setInterval(() => { void recoverBlankWindow('periodic health check') }, WINDOW_HEALTH_INTERVAL_MS)
    windowHealthTimer.unref()
    // The official page's enhanced-features card bridges through these.
    ipcMain.handle('desktop:connection:status', () => getStatusJson())
    ipcMain.handle('desktop:connection:save', (_event, serverUrl: unknown) => {
      try {
        const url = typeof serverUrl === 'string' ? serverUrl.trim() : ''
        saveSettings(typeof url === 'string' && url !== '' ? { serverUrl: url } : {})
        const explicit = normalizeServerUrl(url)
        if (explicit !== undefined) connectTo(explicit)
        else resolveRuntime()
        return { saved: true }
      } catch (error) {
        return { saved: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.on('desktop:open-connection-settings', () => { openSettingsWindow() })
    await guiPathReady
    boot()
    app.on('activate', () => {
      if (mainWindow === null) launchWindow()
    })
  }).catch((error: unknown) => {
    dialog.showErrorBox('Harness', '桌面客户端启动失败。\n' + (error instanceof Error ? error.message : String(error)))
    app.quit()
  })

  app.on('window-all-closed', () => {
    // Tray-resident client: closing the last window keeps the app running.
    // Quit happens through the tray menu, the app menu, or Cmd+Q.
  })

  // Quit owns the local child: the stop ladder runs before the process exits,
  // so the runtime never outlives the client as an orphan holding the data
  // home and a port.
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    if (windowHealthTimer !== undefined) clearInterval(windowHealthTimer)
    void webUi?.stop().finally(() => { app.quit() })
  })
}
