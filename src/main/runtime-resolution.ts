/**
 * The platform-dependent decisions behind locating and launching a
 * user-installed `dsh`, as pure functions.
 *
 * These rules are almost entirely about Windows, and the client is developed
 * and integration-tested on macOS — so they are separated from the process and
 * filesystem work in `index.ts` deliberately. Parameterized by platform rather
 * than reading `process.platform`, every branch is assertable from any
 * machine (`scripts/check-runtime-resolution.mjs`), which is the only Windows
 * coverage that does not require a Windows host.
 *
 * What this module cannot cover, and what a real Windows run still has to
 * prove: process-tree semantics — that `taskkill /T /F` walked from a live
 * parent reaches the server behind a cmd.exe wrapper.
 * @module dsh-desktop/runtime-resolution
 */

// The win32/posix variants explicitly, never the host-dependent default: this
// module is asserted for both platforms from one machine, and `join` alone
// would silently produce the HOST's separators for the other platform's case.
import { posix, win32 } from 'node:path'

/**
 * The filenames to try for `name`, in lookup order.
 *
 * On Windows only extensions the spawn path can actually execute are
 * candidates. npm also writes an extension-less POSIX shell script beside its
 * `.cmd` shim, which Windows cannot run at all, and `.ps1` is not executable
 * through `cmd.exe` either — offering either one would resolve a "found"
 * command that then fails on every launch.
 */
export function executableCandidates(name: string, platform: NodeJS.Platform): string[] {
  // `.exe` first: Node spawns it directly, while `.cmd`/`.bat` need a shell.
  return platform === 'win32'
    ? [name + '.exe', name + '.cmd', name + '.bat']
    : [name]
}

/**
 * One PATH entry as a directory: trimmed, and unwrapped from the surrounding
 * quotes Windows permits (and some installers write).
 */
export function normalizePathEntry(entry: string): string {
  return entry.trim().replace(/^"(.*)"$/, '$1')
}

/**
 * Whether two PATH-shaped strings name the same directory.
 *
 * Windows settles this in three ways POSIX does not: `\` and `/` are both
 * separators, a trailing separator carries no meaning, and the whole
 * comparison is case-insensitive. A PATH entry a user typed themselves can
 * differ from this client's own `join()` output in all three — and this
 * comparison exists to EXCLUDE a directory (the client's node shim), so every
 * spelling that fails to match is a spelling that smuggles the shim back in as
 * a user-installed runtime.
 *
 * Textual only: no symlink, junction, or 8.3 short-name resolution. It answers
 * "the same directory as written", which is the question a PATH entry poses.
 */
export function isSameDirectory(left: string, right: string, platform: NodeJS.Platform): boolean {
  return directoryKey(left, platform) === directoryKey(right, platform)
}

function directoryKey(value: string, platform: NodeJS.Platform): string {
  const unified = platform === 'win32' ? value.replace(/\//g, '\\') : value
  // A root is nothing but its separator, so it is the one case where the
  // trailing separator has to stay.
  const trimmed = unified.replace(/[\\/]+$/, '')
  const key = trimmed === '' ? unified : trimmed
  return platform === 'win32' ? key.toLowerCase() : key
}

/**
 * How a resolved `dsh` binary must be handed to `spawn`.
 *
 * A Windows `.cmd`/`.bat` shim is a batch script, not an image Node can
 * execute: it has to go through the platform shell, which re-parses the
 * command string, so the path is quoted for that round trip. Quoting is safe
 * without escaping because a Windows path cannot contain a double quote. Every
 * other case — a real `.exe`, and everything on POSIX, where a shebang makes
 * the file directly executable — is spawned as-is, and must NOT be quoted:
 * with no shell to strip them, the quotes would become part of the filename.
 */
export function spawnTargetFor(binPath: string, platform: NodeJS.Platform): { command: string; shell: boolean } {
  const shell = platform === 'win32' && /\.(?:cmd|bat)$/i.test(binPath)
  return { command: shell ? '"' + binPath + '"' : binPath, shell }
}

/**
 * The directory npx keeps its per-spec package caches in, or undefined when it
 * cannot be located.
 *
 * This matters because the official install instruction is `npx
 * @deepseek-ai/dsh web`, which puts nothing on PATH — a PATH-only search finds
 * nothing for the users who followed the documentation. A spec that has been
 * run once leaves a complete package here, so reusing it downloads nothing.
 *
 * npm's cache root is `~/.npm` on POSIX and `%LOCALAPPDATA%\npm-cache` on
 * Windows, and `npm_config_cache` overrides both. The layout under it
 * (`_npx/<hash>/node_modules/…`) is npm's internal detail, not a public
 * contract — a miss here simply means the bundled runtime is used, so a future
 * npm reorganizing its cache costs a preference, never a failure.
 */
export function npxCacheRoot(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string | undefined {
  const path = platform === 'win32' ? win32 : posix
  const configured = env.npm_config_cache ?? env.NPM_CONFIG_CACHE
  if (configured !== undefined && configured !== '') return path.join(configured, '_npx')
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    if (localAppData === undefined || localAppData === '') return undefined
    return path.join(localAppData, 'npm-cache', '_npx')
  }
  if (home === '') return undefined
  return path.join(home, '.npm', '_npx')
}

/**
 * The version a `--version` run reported, or undefined when its output carries
 * none.
 *
 * Matched anywhere in a line rather than anchored to its start: a CLI is free
 * to print `dsh 0.2.0` instead of a bare version, and an anchored pattern
 * would silently reject a runtime that works — sending the user back to the
 * bundled one with no explanation.
 */
export function parseVersionOutput(stdout: string): string | undefined {
  for (const entry of stdout.split('\n')) {
    const match = /\d+\.\d+[\w.+-]*/.exec(entry)
    if (match !== null) return match[0]
  }
  return undefined
}
