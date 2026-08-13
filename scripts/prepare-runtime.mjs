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
