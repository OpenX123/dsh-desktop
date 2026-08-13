/**
 * Materialize the official dsh production closure for electron-builder.
 * pnpm's deployed node_modules preserves auto-installed peer packages that
 * electron-builder's dependency walker otherwise omits.
 * @module desktop/scripts/prepare-runtime
 */

import { spawn } from 'node:child_process'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const destination = join(APP_DIR, '.runtime')
await rm(destination, { recursive: true, force: true })

const pnpmArgs = [
  '--filter',
  'dsh-desktop-runtime',
  'deploy',
  '--prod',
  '--frozen-lockfile',
  // A hoisted closure is what survives packaging. pnpm's default layout puts
  // auto-installed peers under .pnpm/node_modules and reaches them by walking
  // up from a symlink's realpath; the Windows NSIS installer materializes those
  // symlinks as real directories, which strands the peers and left the
  // installed build unable to import @deepseek-ai/dsh-app-boot. Hoisting also
  // flattens .pnpm's long store paths, keeping the installed tree inside the
  // 260-character Windows MAX_PATH that the default layout overshot.
  '--node-linker=hoisted',
  '.runtime',
]

// Node 24 no longer launches Windows batch files directly with spawn(). Run
// pnpm through cmd.exe there; every argument is a fixed project-owned value.
const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'pnpm'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', ['pnpm', ...pnpmArgs].join(' ')]
  : pnpmArgs
const child = spawn(command, args, { cwd: APP_DIR, stdio: 'inherit' })

const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
if (code !== 0) throw new Error('dsh runtime deployment failed (code=' + String(code) + ')')

/**
 * Build artefacts that no runtime code path can execute: source maps and
 * TypeScript declarations. Removing them cuts the file count the packager
 * compresses and the installer writes back out, which is the dominant cost of
 * the Windows release job.
 *
 * Matching is by extension only. Pruning conventional directory names is not
 * safe here: `yaml` ships its runtime composer under `dist/doc/`, so a rule
 * that dropped `doc/` silently removed executable code and the packaged app
 * failed to boot. Licence and notice files are untouched for the same reason
 * they must be — the closure is redistributed inside the installer.
 */
const PRUNED_EXTENSIONS = ['.map', '.d.ts', '.d.cts', '.d.mts']
const isPrunedFile = name => PRUNED_EXTENSIONS.some(extension => name.endsWith(extension))

let prunedFiles = 0
let prunedBytes = 0
async function prune(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    // Symlinks are followed by neither branch: the hoisted closure keeps a few,
    // and descending through them would leave the real target half-pruned.
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await prune(path)
      continue
    }
    if (!entry.isFile() || !isPrunedFile(entry.name)) continue
    prunedBytes += (await stat(path)).size
    prunedFiles += 1
    await rm(path, { force: true })
  }
}

const runtimeModules = join(destination, 'node_modules')
await prune(runtimeModules)
console.log('[runtime] pruned ' + prunedFiles + ' development entries ('
  + (prunedBytes / 1e6).toFixed(1) + ' MB) from ' + relative(APP_DIR, runtimeModules))
