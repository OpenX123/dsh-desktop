/**
 * The entry the client runs instead of the official `dsh` bin.
 *
 * A packaged build carries no system Node, so the bundled CLI runs on
 * Electron's own Node through `ELECTRON_RUN_AS_NODE=1`. That variable is
 * inherited by everything the harness starts afterwards — including the
 * Agent's own shell commands — and any Electron-based tool the Agent then runs
 * (`code`, `electron`, an Electron-packaged CLI) starts as a bare Node process
 * and fails on its first `import { app } from 'electron'`. The variable is an
 * implementation detail of how this client launches Node; it must not travel
 * into the Agent's execution environment.
 *
 * It cannot simply be dropped: two runtime paths spawn `process.execPath`
 * expecting Node semantics — the native directory-picker worker (the "add a
 * project folder" dialog on macOS and Windows) and the Windows ACL sandbox
 * runner. So the variable is removed from the ambient environment and
 * re-attached at the spawn boundary, for children that are the Electron binary
 * itself. Every other child — the Agent's shells and their descendants — sees
 * the environment a normally installed `dsh` would give them.
 *
 * Outside a packaged build the CLI runs on a real Node, the variable is absent,
 * and this module only forwards to the official entry.
 * @module dsh-desktop/runtime-launcher
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** The official CLI entry, passed by the main process (never on argv: the
 *  harness parses `process.argv.slice(2)` and must still see `web --port 0`). */
const ENTRY_VARIABLE = 'DSH_DESKTOP_RUNTIME_ENTRY'
const NODE_MODE = 'ELECTRON_RUN_AS_NODE'

/** `(file, args?, options?)`, the shape spawn/spawnSync/fork share. */
type SpawnLike = (...callArguments: unknown[]) => unknown
interface SpawnHost { [name: string]: SpawnLike }
interface SpawnOptions { env?: NodeJS.ProcessEnv }

/**
 * Whether a spawn target is this process's own executable — under Electron's
 * Node mode that is the Electron binary, which needs the variable back or it
 * starts a second copy of the GUI application instead of running the script.
 */
function isSelfExecutable(command: unknown): boolean {
  if (typeof command !== 'string') return false
  if (command === process.execPath) return true
  // Windows paths differ only by case between a caller's spelling and ours.
  return process.platform === 'win32' && command.toLowerCase() === process.execPath.toLowerCase()
}

/**
 * Merge the Node-mode variable into one call's options. An absent `env` means
 * "inherit", and the inherited environment no longer carries the variable, so
 * the ambient values are materialized here rather than left implicit.
 */
function withNodeMode(options: unknown, value: string): SpawnOptions {
  const base = typeof options === 'object' && options !== null ? options as SpawnOptions : {}
  return { ...base, env: { ...base.env ?? process.env, [NODE_MODE]: value } }
}

/**
 * Wrap one spawn-family function so calls that target this executable carry the
 * variable. `args` is optional and positional: when it is not an array the
 * second parameter is the options object.
 */
function patchSpawnLike(host: SpawnHost, name: string, value: string, always: boolean): void {
  const original = host[name]
  if (typeof original !== 'function') return
  host[name] = function patched(this: unknown, ...callArguments: unknown[]): unknown {
    if (always || isSelfExecutable(callArguments[0])) {
      const index = Array.isArray(callArguments[1]) ? 2 : 1
      callArguments[index] = withNodeMode(callArguments[index], value)
    }
    return original.apply(this, callArguments)
  }
}

const entry = process.env[ENTRY_VARIABLE]
if (entry === undefined || entry === '') {
  throw new Error(ENTRY_VARIABLE + ' is required: the desktop client sets it to the bundled dsh entry')
}
// The launcher's own coordinates are not part of the harness's environment.
Reflect.deleteProperty(process.env, ENTRY_VARIABLE)

const nodeMode = process.env[NODE_MODE]
if (nodeMode !== undefined && nodeMode !== '') {
  Reflect.deleteProperty(process.env, NODE_MODE)
  // require(), not an ESM import of the builtin: importing it here would build
  // its ESM facade from the unpatched exports, and the harness's own
  // `import { spawn } from 'node:child_process'` would bind to the originals.
  const childProcess = createRequire(import.meta.url)('node:child_process') as SpawnHost
  patchSpawnLike(childProcess, 'spawn', nodeMode, false)
  patchSpawnLike(childProcess, 'spawnSync', nodeMode, false)
  // fork() always runs a Node script on this executable, and it reaches the
  // real spawn through a module-internal reference the patch above cannot see.
  patchSpawnLike(childProcess, 'fork', nodeMode, true)
}

await import(pathToFileURL(entry).href)
