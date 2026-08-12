/**
 * Desktop glue plugin: the desktop client's own host-plane glue.
 *
 * It provides the `desktopStartup` service (the invocation's `--port` flag),
 * serves the client's built renderer under the `/app/` prefix route, serves
 * the `/desktop/context` workspace-context route (git branch for the context
 * bar), registers the desktop surface prompt section, and prints the
 * readiness line the Electron main process parses.
 *
 * Nothing here belongs to the `dsh` web product: the served dist, the prompt
 * identity, and the readiness protocol are this client's own.
 * @module @deepseek-ai/dsh-desktop/host/glue
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-bash-env'

/** Stable Cordis plugin name. */
export const name = 'desktop-glue'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** The plugin object the harness child mounts programmatically. */
export const desktopGlue = { name, inject, apply }

/** Service provided by this plugin and injected by flag-configured rows. */
export const DESKTOP_STARTUP_SERVICE = 'desktopStartup'

/** What the webserver and preset-roster rows read from {@link DESKTOP_STARTUP_SERVICE}. */
export interface DesktopStartupValues {
  /** `--port`, absent when the invocation did not name one. */
  port?: number
  /** Absolute root of the official deepseek-harness checkout (read-only). */
  harnessRoot: string
}

/** The desktop flag family, as commander parsed it. */
interface DesktopOptions {
  port?: string
}

/** This app's command: its flags and help text. */
function desktopCommand(): Command {
  return new Command()
    .name('harness-desktop host')
    .description('Run the DeepSeek Harness desktop client runtime.')
    .helpOption('-h, --help', 'show this help')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
}

/** Turn the parsed flags into the value injected rows read. */
function planDesktopStartup(program: Command): Pick<DesktopStartupValues, 'port'> {
  const options = program.opts<DesktopOptions>()
  if (options.port !== undefined && !/^\d+$/.test(options.port)) {
    program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
  }
  return {
    ...options.port !== undefined && { port: Number(options.port) },
  }
}

/** The built renderer directory, resolved at module load from the app layout. */
const DIST_DIR = fileURLToPath(new URL('../../dist', import.meta.url))

/**
 * The official deepseek-harness checkout, consumed read-only: the sibling
 * project this client builds on. `DSH_HARNESS_REPO` names it explicitly;
 * otherwise the two conventional sibling names are probed. Missing means the
 * client cannot boot (its package links point into that checkout), so this
 * fails loud at load.
 * @returns the absolute checkout root.
 */
function harnessRepoRoot(): string {
  const explicit = process.env.DSH_HARNESS_REPO
  if (explicit !== undefined) return explicit
  const parent = fileURLToPath(new URL('../../..', import.meta.url))
  for (const name of ['deepseek-harness', 'test-bruc3van']) {
    const candidate = join(parent, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  throw new Error('dsh-desktop: cannot locate the official deepseek-harness checkout; set DSH_HARNESS_REPO to its absolute path')
}

/** The official checkout root (for the harness-source prompt section). */
const REPO_ROOT = harnessRepoRoot()

/** Static content types for the renderer assets. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

/** Serve one static file; 404 when missing (fallback serves the SPA index). */
async function serveFile(
  absolutePath: string,
  res: { writeHead(statusCode: number, headers: Record<string, string>): void; end(body?: string): void },
  fallback?: string,
): Promise<void> {
  try {
    const info = await stat(absolutePath)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(absolutePath, 'utf8')
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(absolutePath)] ?? 'application/octet-stream',
      'cache-control': absolutePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch {
    if (fallback === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    await serveFile(fallback, res)
  }
}

/** Model-visible orientation for sessions created through the desktop client. */
function desktopSurfacePrompt(): string {
  return 'You are interacting with the user through the DeepSeek Harness desktop client, a standalone GUI application on the user\'s machine. '
    + 'When the user refers to "this app", "the client", "this window", or "the desktop app", they mean this client. '
    + 'The client provides no implicit DOM, route, or screenshot context; you see the conversation and the tools you call. '
    + 'Sessions run in a local harness runtime spawned by the client; your working directory is the session\'s workspace.'
}

/**
 * Resolve a workspace path's context facts for the composer bar. Async: the
 * git probe must never block the event loop that serves /api and the
 * downlink streams.
 * @param path - the workspace path; an absent path resolves the home dir.
 * @returns the resolved path, whether it exists, and the git branch when known.
 */
async function workspaceContext(path: string | null): Promise<{ path: string; branch?: string; exists: boolean }> {
  const home = process.env.HOME ?? ''
  const resolved = path === null || path === '' ? home : path
  let exists = false
  try {
    exists = statSync(resolved).isDirectory()
  } catch {
    exists = false
  }
  let branch: string | undefined
  if (exists) {
    branch = await new Promise<string | undefined>((resolve) => {
      const probe = spawn('git', ['-C', resolved, 'branch', '--show-current'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      let output = ''
      probe.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      probe.on('close', (code) => {
        resolve(code === 0 && output.trim() !== '' ? output.trim() : undefined)
      })
      probe.on('error', () => { resolve(undefined) })
    })
  }
  return { path: resolved, ...branch !== undefined && { branch }, exists }
}

/**
 * Mount the desktop runtime: startup provider, /app static serving, the
 * workspace-context route, the surface prompt, and the readiness line.
 * @param ctx - plugin context carrying the command line.
 * @returns nothing once values are provided, or when the command requested exit.
 */
export function apply(ctx: Context): void {
  const values = parseCmdline(ctx, desktopCommand(), planDesktopStartup)
  if (values === undefined) return
  ctx.provide(DESKTOP_STARTUP_SERVICE, { ...values, harnessRoot: REPO_ROOT })

  ctx.inject(['httpServer'], (httpCtx) => {
    // The client's renderer, served under the /app prefix route (same-origin
    // with the /api carrier, so the trust fence passes without markers).
    const indexHtml = join(DIST_DIR, 'index.html')
    const appRoute = httpCtx.httpServer.register({
      kind: 'prefix',
      path: '/app',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const raw = url.pathname === '/app' ? '/index.html' : url.pathname.slice('/app'.length)
        // Path-traversal fence: resolved candidate must stay inside DIST_DIR.
        const candidate = normalize(join(DIST_DIR, raw))
        if (!candidate.startsWith(DIST_DIR + sep) && candidate !== DIST_DIR + sep && candidate !== normalize(DIST_DIR + '/index.html')) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('forbidden')
          return
        }
        void serveFile(candidate, res, indexHtml)
      },
    })
    // The context bar's workspace facts: path and git branch (computed on the
    // host, never exposed to the model plane).
    const contextRoute = httpCtx.httpServer.register({
      kind: 'exact',
      path: '/desktop/context',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const body = JSON.stringify(await workspaceContext(url.searchParams.get('path')))
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(body)
      },
    })
    // The readiness line: supervisors open the window when they see it, so it
    // must not print while sibling rows (the /api route owner) still mount.
    const settled = httpCtx.get('loader')?.await()
    const printUrl = (): void => {
      const port = httpCtx.httpServer.port
      console.log(`dsh-desktop: http://127.0.0.1:${String(port)}/app/`)
    }
    if (settled === undefined) printUrl()
    else void settled.then(() => {
      if (httpCtx.get('httpServer') !== undefined) printUrl()
    }, () => {})
    return [appRoute, contextRoute]
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    const surface = promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: desktopSurfacePrompt,
    })
    const source = addHarnessSourceSection(promptCtx, REPO_ROOT)
    return [surface, source].filter((disposer): disposer is () => void => disposer !== undefined)
  })

  ctx.inject(['bashEnv'], (envCtx) => {
    return envCtx.bashEnv.register({
      name: 'desktop-runtime',
      variables: {
        DSH_DESKTOP_URL: { description: 'Canonical local URL of the DeepSeek Harness desktop client serving this session.' },
      },
      resolve: () => {
        const port = ctx.get('httpServer')?.port
        return port === undefined ? {} : { DSH_DESKTOP_URL: `http://127.0.0.1:${String(port)}/app/` }
      },
    })
  })
}
