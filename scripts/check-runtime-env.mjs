/**
 * Runtime-launcher contract: the packaged client boots the official CLI on
 * Electron's Node, and `ELECTRON_RUN_AS_NODE` must not travel from there into
 * the Agent's execution environment — while the two runtime paths that respawn
 * `process.execPath` (the native directory picker, the Windows ACL sandbox
 * runner) must still receive it. Runs the built launcher against a fixture
 * entry that reports what its own children see.
 *
 * With no argument the launcher runs on this Node, which covers the patching
 * contract itself. Passing a packaged client's executable runs the same
 * fixture on the Electron Node a release actually uses — the only place where
 * "spawn my own executable and get Node" is a real code path.
 * Usage: node scripts/check-runtime-env.mjs [node-or-packaged-executable]
 * @module desktop/scripts/check-runtime-env
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const LAUNCHER = join(APP_DIR, '.build', 'runtime-launcher.mjs')
if (!existsSync(LAUNCHER)) throw new Error('run `pnpm run build` first: ' + LAUNCHER + ' is missing')

// `pnpm run <script> -- <path>` forwards the separator itself as an argument.
const requested = process.argv.slice(2).find(argument => argument !== '--')
const EXECUTABLE = requested === undefined ? process.execPath : resolve(requested)
if (!existsSync(EXECUTABLE)) throw new Error('executable does not exist: ' + EXECUTABLE)

const workDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-env-'))
// The fixture stands in for the official bin: it reports its own environment,
// what an ordinary child (an Agent shell) inherits, and what a child spawned on
// this executable (the picker worker) inherits.
const fixture = join(workDir, 'entry.mjs')
await writeFile(fixture, `
import { spawnSync } from 'node:child_process'

const readVariable = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return (result.stdout ?? '').trim()
}
const plain = process.platform === 'win32'
  ? readVariable(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'echo %ELECTRON_RUN_AS_NODE%'])
  : readVariable('/bin/sh', ['-c', 'printf %s "$ELECTRON_RUN_AS_NODE"'])

console.log('RESULT ' + JSON.stringify({
  argv: process.argv.slice(2),
  ambient: process.env.ELECTRON_RUN_AS_NODE ?? null,
  entryVariable: process.env.DSH_DESKTOP_RUNTIME_ENTRY ?? null,
  // cmd.exe echoes the literal name when the variable is unset.
  plainChild: plain === '%ELECTRON_RUN_AS_NODE%' ? '' : plain,
  selfChild: readVariable(process.execPath, ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "")']),
}))
`)

/** Run the launcher with the fixture as its entry; resolve its reported facts. */
async function runLauncher(nodeMode) {
  const env = { ...process.env, DSH_DESKTOP_RUNTIME_ENTRY: fixture }
  if (nodeMode === undefined) Reflect.deleteProperty(env, 'ELECTRON_RUN_AS_NODE')
  else env.ELECTRON_RUN_AS_NODE = nodeMode
  const child = spawn(EXECUTABLE, [LAUNCHER, 'web', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  // A broken contract can mean the executable opened its GUI instead of
  // running the launcher, and a GUI never exits. Fail here with what happened
  // rather than hanging until the CI job's own timeout.
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('launcher run did not exit within 30s — the executable may have started its GUI instead'))
    }, 30_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', value => { clearTimeout(timer); resolve(value) })
  })
  const line = stdout.split('\n').find(entry => entry.startsWith('RESULT '))
  if (code !== 0 || line === undefined) {
    throw new Error('launcher run failed (code=' + String(code) + ')\n' + stdout + stderr)
  }
  return JSON.parse(line.slice('RESULT '.length))
}

const checks = []
const check = (name, ok, detail) => { checks.push({ ok, name, detail }) }

/**
 * The launcher re-attaches the variable by patching `child_process`'s exported
 * `spawn`/`spawnSync`/`fork`. `execFile`/`exec` reach the real spawn through a
 * module-internal reference that no export patch can see — and the bundled
 * harness already uses `execFile` elsewhere — so a future runtime that
 * respawned `process.execPath` through one of them would quietly start a second
 * GUI instead of a Node child, breaking the native directory picker and the
 * Windows ACL sandbox runner. Pin the assumption to the bundled closure: every
 * `process.execPath` site must be an argument to a patched call, or a site
 * audited here.
 */
const AUDITED_INDIRECT = new Map([
  ['@deepseek-ai/dsh-sandbox-local/lib/index.js',
    'windowsAclRunnerInvocation() returns an argv whose [0] is process.execPath; it is consumed by '
    + 'child_process.spawn in dsh-subprocess-local and by spawnSync in this module\'s own probe.'],
])
const PATCHED_CALL = /(?:^|[^.\w$])(?:spawn|spawnSync|fork)\s*\(\s*$/

/** Keep allow-list keys stable when this scan runs on Windows. */
function runtimeAuditPath(packageName, packageRelativePath) {
  return '@deepseek-ai/' + packageName + packageRelativePath.replaceAll('\\', '/')
}

const windowsAuditPath = runtimeAuditPath('dsh-sandbox-local', '\\lib\\index.js')
check('runtime audit paths are platform-neutral',
  windowsAuditPath === '@deepseek-ai/dsh-sandbox-local/lib/index.js', windowsAuditPath)

async function scanRuntimeExecPathSites(runtimeModules) {
  const offenders = []
  let sites = 0
  const scopeDir = join(runtimeModules, '@deepseek-ai')
  for (const packageName of await readdir(scopeDir)) {
    const libDir = join(scopeDir, packageName, 'lib')
    if (!existsSync(libDir)) continue
    const stack = [libDir]
    while (stack.length > 0) {
      const directory = stack.pop()
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        // Nested dependency trees are third-party code the harness only
        // consumes; this contract is about the harness's own spawn sites.
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') stack.push(path)
          continue
        }
        if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue
        const source = await readFile(path, 'utf8')
        let index = source.indexOf('process.execPath')
        while (index !== -1) {
          sites += 1
          const relative = runtimeAuditPath(packageName, path.slice(join(scopeDir, packageName).length))
          if (!PATCHED_CALL.test(source.slice(Math.max(0, index - 60), index)) && !AUDITED_INDIRECT.has(relative)) {
            const line = source.slice(0, index).split('\n').length
            offenders.push(relative + ':' + String(line) + ' — ' + source.slice(index - 40 < 0 ? 0 : index - 40, index + 40).replace(/\s+/g, ' ').trim())
          }
          index = source.indexOf('process.execPath', index + 1)
        }
      }
    }
  }
  return { offenders, sites }
}

try {
  const packagedLike = await runLauncher('1')
  check('harness argv unchanged', JSON.stringify(packagedLike.argv) === JSON.stringify(['web', '--port', '0']),
    JSON.stringify(packagedLike.argv))
  check('Node-mode variable removed from the runtime environment', packagedLike.ambient === null,
    String(packagedLike.ambient))
  check('launcher entry variable not leaked to the harness', packagedLike.entryVariable === null,
    String(packagedLike.entryVariable))
  check('Agent children do not inherit the Node-mode variable', packagedLike.plainChild === '',
    JSON.stringify(packagedLike.plainChild))
  check('process.execPath children still receive it', packagedLike.selfChild === '1',
    JSON.stringify(packagedLike.selfChild))

  // Development and any real Node install: nothing to strip, nothing patched.
  // Only a real Node can run this arm — without the variable, a packaged
  // executable starts its GUI instead of the launcher.
  if (requested === undefined) {
    const plainNode = await runLauncher(undefined)
    check('unpatched pass-through on a real Node', plainNode.ambient === null && plainNode.selfChild === '',
      JSON.stringify(plainNode))
  }

  // Only meaningful once the closure is deployed (`pnpm run prepare:runtime`);
  // the release job runs that first, so a runtime upgrade cannot slip past.
  const runtimeModules = join(APP_DIR, '.runtime', 'node_modules')
  if (existsSync(join(runtimeModules, '@deepseek-ai'))) {
    const { offenders, sites } = await scanRuntimeExecPathSites(runtimeModules)
    check('bundled runtime respawns process.execPath only through patched APIs',
      offenders.length === 0, offenders.join(' | ') + ' (audit these sites, then extend AUDITED_INDIRECT)')
    if (offenders.length === 0) console.log('  (' + String(sites) + ' process.execPath sites scanned in the bundled closure)')
  } else {
    console.log('  (bundled closure absent — run `pnpm run prepare:runtime` to also check its spawn sites)')
  }
} finally {
  await rm(workDir, { recursive: true, force: true })
}

for (const entry of checks) {
  console.log((entry.ok ? '✓ ' : '✗ ') + entry.name + (entry.ok ? '' : ' — ' + entry.detail))
}
if (checks.some(entry => !entry.ok)) throw new Error('runtime environment contract violated')
