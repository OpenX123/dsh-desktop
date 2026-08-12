/**
 * Electron main process for the DeepSeek Harness desktop client.
 *
 * Owns the window and the harness runtime child: it spawns the harness host
 * (a plain Node process running apps/desktop/src/host/main.ts — the client's
 * OWN composition, never the `dsh` web profile), waits for its readiness
 * line, and loads the client renderer from the harness carrier (same-origin
 * with the /api wire contract).
 *
 * Path expressions resolve at runtime from the BUILT bundle
 * (apps/desktop/.build/main.mjs), so relative URLs are written against that
 * layout, not the source tree.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, shell } from 'electron'

/** apps/desktop (the built bundle sits at apps/desktop/.build/main.mjs). */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url))

/** The harness child entry (run under tsx in dev; bundled in the packaged app). */
const HOST_ENTRY = fileURLToPath(new URL('../src/host/main.ts', import.meta.url))

/**
 * The tsx ESM loader, as an absolute path: `node --import <specifier>` resolves
 * specifiers from the child's cwd, which is the harness home, not the repo —
 * so the loader must be named absolutely.
 */
const TSX_LOADER = createRequire(join(APP_DIR, 'package.json')).resolve('tsx/esm')

/** The built renderer, which must exist before the harness child serves it. */
const RENDERER_INDEX = join(APP_DIR, 'dist', 'index.html')

/** The client's own data home (independent of the dsh CLI's ~/.dsh). */
function harnessHome(): string {
  return process.env.DSH_DESKTOP_HOME ?? join(homedir(), '.dsh-desktop')
}

/** Parse the readiness line the desktop glue prints once the carrier is up. */
function parseReadiness(line: string): string | undefined {
  const match = /^dsh-desktop:\s+(\S+)/.exec(line)
  return match?.[1]
}

/** One harness child generation: process + its own lifecycle listeners. */
interface HarnessGeneration {
  child: ChildProcess
  /** Settles with the app URL when THIS generation reports readiness. */
  ready: Promise<string>
}

/**
 * The harness runtime manager: spawn generations on demand, resolve the
 * served URL once, report every exit through one callback so the window
 * owner can decide relaunch vs. fatal.
 */
class HarnessManager {
  private generation: HarnessGeneration | undefined
  /** Whether any generation ever reported readiness (the window exists). */
  private everReady = false

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
    if (spawned === undefined) return Promise.reject(new Error('harness spawn failed'))
    return spawned.ready
  }

  spawn(): void {
    const child = spawn(process.env.DSH_DESKTOP_NODE ?? 'node', [
      '--import', TSX_LOADER, HOST_ENTRY, '--port', '0',
    ], {
      cwd: harnessHome(),
      env: {
        ...process.env,
        DSH_HOME: harnessHome(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let resolveReady: (url: string) => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const gen: HarnessGeneration = { child, ready }

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
      // Flush a final unterminated line (the readiness line always ends
      // with a newline, but a crashed child may not have flushed).
      if (stdoutBuffer.trim() !== '') this.onLog(stdoutBuffer)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[harness] ${chunk.toString()}`)
    })
    child.on('exit', (code, signal) => {
      if (this.generation === gen) this.generation = undefined
      rejectReady(new Error(`harness exited before ready (code=${String(code)})`))
      this.onExit({ everReady: this.everReady, code, signal })
    })
    this.generation = gen
  }

  /** Stop the current generation (graceful, bounded). */
  async stop(): Promise<void> {
    const gen = this.generation
    if (gen === undefined || gen.child.exitCode !== null) return
    gen.child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { gen.child.kill('SIGKILL'); resolve() }, 3000)
      gen.child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}

let mainWindow: BrowserWindow | null = null
let harness: HarnessManager | undefined
let launchBudget = 3

/** Open external links in the system browser; never in a client window. */
function openExternal(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
}

/**
 * The app's own origin (the loopback harness carrier). Navigation away from
 * it is an external link, never a new client page.
 */
function appOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** Create the client window pointed at the harness carrier. */
function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Harness',
    backgroundColor: '#FFFFFF',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--dsh-username=${userInfo().username}`],
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  mainWindow.once('ready-to-show', () => { mainWindow?.show() })
  mainWindow.on('closed', () => { mainWindow = null })
  // The renderer is served by the loopback carrier; anything it tries to
  // open elsewhere goes to the system browser, and no new windows exist.
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
  void mainWindow.loadURL(url)
}

/** The application menu: standard roles, with the client's own name. */
function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : [],
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Attach the harness lifecycle to the app lifetime. */
function boot(): void {
  if (!existsSync(RENDERER_INDEX)) {
    dialog.showErrorBox('Harness', `缺少构建产物：${RENDERER_INDEX}\n请先运行 pnpm --filter @deepseek-ai/dsh-desktop run build:renderer`)
    app.quit()
    return
  }

  /** Open the window when the CURRENT generation reports readiness. */
  const launchWindow = (): void => {
    void harness?.ready().then((url) => {
      if (mainWindow === null) createWindow(url)
    }, () => {
      // Startup failure is owned by the onExit path below.
    })
  }

  harness = new HarnessManager(
    (line) => { console.log(`[harness] ${line}`) },
    ({ everReady, code, signal }) => {
      if (mainWindow === null && !everReady && launchBudget > 0) {
        // Startup failure: relaunch the runtime generation and await ITS
        // readiness (the first generation's promise already rejected).
        launchBudget -= 1
        console.error(`[desktop] harness failed to start (${String(code)}/${String(signal)}); relaunching (${launchBudget} left)`)
        harness?.spawn()
        launchWindow()
        return
      }
      if (mainWindow === null) {
        // Never became ready and the relaunch budget ran out.
        console.error(`[desktop] harness failed to start (${String(code)}/${String(signal)}); no relaunches left`)
        dialog.showErrorBox('Harness', `本地运行时启动失败（代码 ${String(code)} / 信号 ${String(signal)}）。\n请查看日志后重试。`)
        app.quit()
        return
      }
      // A live window lost its runtime: fatal.
      console.error(`[desktop] harness exited (${String(code)}/${String(signal)})`)
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Harness',
        message: '运行时意外退出',
        detail: `代码 ${String(code)} / 信号 ${String(signal)}。`,
        buttons: ['退出'],
      }).then(() => { app.quit() })
    },
  )

  launchWindow()
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
    installMenu()
    boot()
    app.on('activate', () => {
      if (mainWindow === null && harness !== undefined) {
        void harness.ready().then((url) => { createWindow(url) }, () => {})
      }
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  // Quit owns the harness child: the SIGTERM → SIGKILL ladder runs before
  // the process exits, so the runtime never outlives the client as an orphan
  // holding the data home and a port.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void harness?.stop().finally(() => { app.quit() })
  })
}
