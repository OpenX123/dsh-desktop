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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'

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
 * The bundled dsh CLI: the app's own `@deepseek-ai/dsh` dependency (the
 * official npm distribution of the dsh CLI). The package is not on the
 * registry yet, so this resolves only once it is installed — in development
 * after a future `pnpm install`, and in the packaged app from the bundled
 * node_modules. No user-facing npm command is ever involved.
 */
function resolveBundledDsh(): DshCommand | undefined {
  try {
    const require = createRequire(join(APP_DIR, 'package.json'))
    const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
    return { command: nodeForChild(), args: [bin], label: bin }
  } catch {
    return undefined
  }
}

/**
 * Resolve the `dsh` command the client spawns for local mode. Order: the
 * explicit DSH_DESKTOP_DSH override, the app-bundled npm package, `dsh` on
 * PATH, and finally the conventional sibling checkouts (dev convenience;
 * never a package dependency).
 */
interface DshCommand {
  command: string
  args: string[]
  label: string
}

function resolveDshCommand(): DshCommand {
  const explicit = process.env.DSH_DESKTOP_DSH
  if (explicit !== undefined && explicit.trim() !== '') {
    return { command: explicit, args: [], label: explicit }
  }
  const bundled = resolveBundledDsh()
  if (bundled !== undefined) return bundled
  // Dev convenience: probe sibling checkouts (read-only; never a package dependency).
  const siblings = fileURLToPath(new URL('../..', import.meta.url))
  for (const name of ['test-bruc3van', 'deepseek-harness']) {
    const bin = join(siblings, name, 'apps', 'cli', 'lib', 'bin.js')
    if (existsSync(bin)) {
      const node = process.env.DSH_DESKTOP_NODE ?? 'node'
      return { command: node, args: [bin], label: bin }
    }
  }
  return { command: 'dsh', args: [], label: 'dsh' }
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
}

/**
 * The local `dsh web` runtime manager: spawn generations on demand, resolve
 * the served URL once, report every exit through one callback so the window
 * owner can decide relaunch vs. fatal.
 */
class WebUiManager {
  private generation: WebUiGeneration | undefined
  /** Whether any generation ever reported readiness. */
  private everReady = false
  lastError: string | null = null

  constructor(
    private readonly onLog: (line: string) => void,
    private readonly onExit: (info: { everReady: boolean; code: number | null; signal: NodeJS.Signals | null }) => void,
  ) {}

  /** The current generation's readiness, or a fresh spawn when none exists. */
  ready(): Promise<string> {
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
    const dsh = resolveDshCommand()
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
    const gen: WebUiGeneration = { child, ready }

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
        if (url !== undefined) {
          this.everReady = true
          resolveReady(url)
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
      if (this.generation === gen) this.generation = undefined
      rejectReady(error)
      this.onExit({ everReady: this.everReady, code: null, signal: null })
    })
    child.on('exit', (code, signal) => {
      if (this.generation === gen) this.generation = undefined
      rejectReady(new Error('dsh web exited before ready (code=' + String(code) + ')'))
      this.onExit({ everReady: this.everReady, code, signal })
    })
    this.generation = gen
  }

  /**
   * Stop the current generation. On POSIX the SIGTERM → SIGKILL ladder gives
   * the harness its graceful disposal window; on Windows signals cannot be
   * caught, so the whole process tree is terminated (taskkill /T /F).
   */
  async stop(): Promise<void> {
    const gen = this.generation
    if (gen === undefined || gen.child.exitCode !== null) return
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
  }
}

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let settingsServerPort = 0
let tray: Tray | null = null
let webUi: WebUiManager | undefined
let launchBudget = 3
let quitting = false

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
async function probeWebUi(base: string): Promise<string | undefined> {
  try {
    const response = await fetch(base + '/api/host.describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'desktop-probe', method: 'host.describe', payload: {} }),
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { result?: { ok?: boolean } }
    if (body.result?.ok !== true) return undefined
    return new URL(base).origin
  } catch {
    return undefined
  }
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

/** The official DeepSeek Harness logo: rounded-corner dark tile with the white glyph. */
const ICON_PNG = join(APP_DIR, 'resources', 'icon-app.png')

/** Create the client window pointed at the official Web UI. */
function createWindow(url: string): void {
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
  mainWindow.on('closed', () => { mainWindow = null })
  // The official Web UI is loaded; anything it tries to open elsewhere goes
  // to the system browser, and no new windows exist.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const current = mainWindow?.webContents.getURL()
    if (current !== undefined && appOrigin(targetUrl) !== appOrigin(current)) {
      event.preventDefault()
      openExternal(targetUrl)
    }
  })
  // An unreachable Web UI (connect mode) must not strand the user: offer
  // retry or the connection-settings window.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || quitting || code === -3) return // -3 = ERR_ABORTED
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
  void mainWindow.loadURL(url)
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
  })
  settingsWindow.on('closed', () => { settingsWindow = null })
  void settingsWindow.loadURL('http://127.0.0.1:' + String(settingsServerPort) + '/')
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
    ...webUi?.pid() !== undefined && { childPid: webUi.pid() },
    ...webUi?.lastError !== null && webUi?.lastError !== undefined && { lastError: webUi.lastError },
  }
}

/** The connection-settings page (self-contained; no assets). */
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
    + '<label for="url">Web UI 地址（留空 = 本地启动 dsh）</label>'
    + '<input id="url" placeholder="http://127.0.0.1:3080" spellcheck="false">'
    + '<div><button id="save" class="primary">保存并重连</button><button id="close">关闭</button></div>'
    + '<p id="note"></p>'
    + '<script>'
    + 'const $ = id => document.getElementById(id);'
    + 'async function refresh(){try{const s=await(await fetch("/desktop/status")).json();'
    + 'const modeLabel=s.mode==="probe"?"已连接本机正在运行的官方实例":s.mode==="connect"?"连接":"本地 dsh web";'
    + '$("status").textContent=modeLabel+(s.childPid?" (PID "+s.childPid+")":"")+" → "+(s.targetUrl||"（未就绪）")+(s.lastError?" · "+s.lastError:"");'
    + 'const c=await(await fetch("/desktop/settings")).json();$("url").value=c.serverUrl??"";}catch(e){$("status").textContent="状态不可用"}}'
    + '$("save").onclick=async()=>{try{const r=await fetch("/desktop/settings",{method:"POST",headers:{"content-type":"application/json"},'
    + 'body:JSON.stringify({serverUrl:$("url").value.trim()})});const j=await r.json();'
    + '$("note").textContent=j.saved?"已保存，正在重连…":("保存失败："+(j.error||"未知错误"));'
    + 'if(j.saved)setTimeout(()=>window.close(),900)}catch(e){$("note").textContent="保存失败："+e.message}};'
    + '$("close").onclick=()=>window.close();refresh();'
    + '</script></body></html>'
}

/** Connect to a fixed Web UI origin: stop any local child, point the window at it. */
function connectTo(url: string): void {
  configuredTarget = url
  probeConnected = false
  if (webUi !== undefined) void webUi.stop()
  launchWindow()
}

/** Use the local `dsh web` child (spawned on demand, awaited via readiness). */
function startLocalRuntime(): void {
  configuredTarget = undefined
  probeConnected = false
  if (webUi !== undefined && childTarget === undefined && webUi.pid() === undefined) {
    webUi.spawn()
  }
  launchWindow()
}

/** Smart mode: prefer a locally running official instance, else launch our own. */
function resolveRuntime(): void {
  void probeWebUi(DEFAULT_WEB_PROBE_URL).then((probed) => {
    if (quitting) return
    if (probed !== undefined) {
      configuredTarget = probed
      probeConnected = true
      launchWindow()
      return
    }
    startLocalRuntime()
  })
}

/** Open the window at the CURRENT target, waiting for local readiness if needed. */
function launchWindow(): void {
  if (configuredTarget !== undefined) {
    if (mainWindow === null) createWindow(configuredTarget)
    return
  }
  void webUi?.ready().then((url) => {
    childTarget = url
    if (mainWindow === null) createWindow(url)
    else if (configuredTarget === undefined) void mainWindow.loadURL(url)
  }, () => { /* startup failure is owned by the onExit path */ })
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

/** The minimal loopback server: status + settings routes and the settings page. */
function startSettingsServer(): number {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    if (pathname === '/desktop/status') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(JSON.stringify(getStatusJson()))
      return
    }
    if (pathname === '/desktop/settings') {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
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
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    settingsServerPort = typeof address === 'object' && address !== null ? address.port : 0
  })
  return settingsServerPort
}

function boot(): void {
  const settings = loadSettings()
  webUi = new WebUiManager(
    (line) => { console.log('[dsh web] ' + line) },
    ({ everReady, code, signal }) => {
      if (quitting) return
      if (configuredTarget !== undefined) {
        // Connect/probe mode: a child exit is irrelevant (there should be none).
        return
      }
      if (mainWindow === null && !everReady && launchBudget > 0) {
        launchBudget -= 1
        console.error('[desktop] dsh web failed to start (' + String(code) + '/' + String(signal) + '); relaunching (' + String(launchBudget) + ' left)')
        webUi?.spawn()
        launchWindow()
        return
      }
      if (mainWindow === null && everReady) {
        // The window is closed (tray mode): restart the runtime quietly so
        // the next window open finds a live child.
        console.error('[desktop] dsh web exited while the window was closed; restarting quietly')
        launchBudget = 3
        webUi?.spawn()
        return
      }
      if (mainWindow === null) {
        console.error('[desktop] dsh web failed to start (' + String(code) + '/' + String(signal) + '); no relaunches left')
        const reason = webUi?.lastError
        dialog.showErrorBox('Harness', '本地 dsh web 启动失败（代码 ' + String(code) + ' / 信号 ' + String(signal) + '）。\n'
          + (reason !== null && reason !== undefined ? reason + '\n' : '')
          + '请确认 dsh 已安装（或通过菜单 "Web UI 连接…" 填写 Web UI 地址）。')
        app.quit()
        return
      }
      // A live window lost its runtime: fatal.
      console.error('[desktop] dsh web exited (' + String(code) + '/' + String(signal) + ')')
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Harness',
        message: '运行时意外退出',
        detail: '代码 ' + String(code) + ' / 信号 ' + String(signal) + '。',
        buttons: ['退出'],
      }).then(() => { app.quit() })
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
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    app.setName('Harness')
    // The official logo in the macOS dock (rounded-corner tile, white glyph).
    if (process.platform === 'darwin') {
      const dockIcon = nativeImage.createFromPath(ICON_PNG)
      if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon)
    }
    installMenu()
    createTray()
    startSettingsServer()
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
    boot()
    app.on('activate', () => {
      if (mainWindow === null) launchWindow()
    })
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
    void webUi?.stop().finally(() => { app.quit() })
  })
}