/**
 * Release-package smoke: launch the unpacked application with an empty PATH,
 * require it to select the bundled official dsh CLI, and probe the resulting
 * Web UI. This catches installers that work only on a developer machine.
 * Usage: node scripts/smoke-package.mjs [packaged-executable]
 * @module desktop/scripts/smoke-package
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const RELEASE_DIR = join(APP_DIR, 'release')
const PRODUCT_NAME = 'DeepSeek Harness Desktop'

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function findExecutable() {
  const requested = process.argv[2]
  if (requested !== undefined) return resolve(requested)

  const files = await walk(RELEASE_DIR)
  if (process.platform === 'darwin') {
    return files.find(path => path.endsWith('.app/Contents/MacOS/' + PRODUCT_NAME))
  }
  if (process.platform === 'win32') {
    return files.find(path => basename(path).toLowerCase() === PRODUCT_NAME.toLowerCase() + '.exe'
      && path.toLowerCase().includes('win-unpacked'))
  }

  return files.find(path => path.includes('linux-unpacked') && basename(path) === 'dsh-desktop')
}

const executable = await findExecutable()
if (executable === undefined) throw new Error('packaged executable not found under ' + RELEASE_DIR)

const smokeHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-package-smoke-'))
const emptyPath = join(smokeHome, 'empty-path')
// Spreading process.env drops the case-insensitivity Windows env vars have:
// the system spells the search path `Path`, so a literal `PATH` override would
// leave the inherited `Path` in the object and libuv's case-insensitive
// deduplication could keep either one. Strip every casing first, so this smoke
// really runs with no system PATH on all platforms. `ELECTRON_RUN_AS_NODE`
// (Codex and some CI wrappers set it) is uppercase everywhere, but goes
// through the same filter for consistency.
const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
  const upper = key.toUpperCase()
  if (upper === 'PATH' || upper === 'ELECTRON_RUN_AS_NODE') continue
  childEnv[key] = value
}
const child = spawn(executable, ['--user-data-dir=' + join(smokeHome, 'chromium')], {
  env: {
    ...childEnv,
    DSH_HOME: join(smokeHome, 'dsh'),
    DSH_DESKTOP_HOME: join(smokeHome, 'desktop'),
    DSH_DESKTOP_SKIP_PROBE: '1',
    PATH: emptyPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let settled = false
const append = chunk => {
  output += chunk.toString()
  if (output.length > 100_000) output = output.slice(-100_000)
}
const readiness = new Promise((resolveReady, rejectReady) => {
  const finishError = error => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    rejectReady(error)
  }
  const timeout = setTimeout(() => finishError(new Error('timed out waiting for packaged dsh web')), 60_000)
  const inspect = chunk => {
    append(chunk)
    const match = /\[desktop\] dsh runtime ready:\s+(http:\/\/\S+)/.exec(output)
    if (match === null || settled) return
    settled = true
    clearTimeout(timeout)
    resolveReady(match[1])
  }
  child.stdout.on('data', inspect)
  child.stderr.on('data', inspect)
  child.once('exit', code => {
    finishError(new Error('packaged app exited before readiness (code=' + String(code) + ')'))
  })
})

try {
  const url = await readiness
  if (!output.includes('[desktop] dsh runtime: bundled')) {
    throw new Error('packaged app did not select the bundled dsh runtime')
  }
  const response = await fetch(url + '/api/host.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'package-smoke', method: 'host.describe', payload: {} }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json()
  if (!response.ok || body?.result?.ok !== true) throw new Error('packaged Web UI probe failed')
  console.log('✓ packaged app selected its bundled @deepseek-ai/dsh runtime')
  console.log('✓ packaged Web UI answered host.describe at ' + url)
} catch (error) {
  console.error(output)
  throw error
} finally {
  if (child.exitCode === null) child.kill()
  if (child.exitCode === null) {
    await Promise.race([
      new Promise(resolveExit => child.once('exit', resolveExit)),
      new Promise(resolveTimeout => setTimeout(resolveTimeout, 5_000)),
    ])
  }
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(smokeHome, { recursive: true, force: true })
}
