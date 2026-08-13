/**
 * Materialize the official dsh production closure for electron-builder.
 * pnpm's deployed node_modules preserves auto-installed peer packages that
 * electron-builder's dependency walker otherwise omits.
 * @module desktop/scripts/prepare-runtime
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const destination = join(APP_DIR, '.runtime')
await rm(destination, { recursive: true, force: true })

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = spawn(command, [
  '--filter',
  'dsh-desktop-runtime',
  'deploy',
  '--prod',
  '--frozen-lockfile',
  destination,
], { cwd: APP_DIR, stdio: 'inherit' })

const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
if (code !== 0) throw new Error('dsh runtime deployment failed (code=' + String(code) + ')')
