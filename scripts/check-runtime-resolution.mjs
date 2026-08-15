/**
 * Platform-decision unit check for `src/main/runtime-resolution.ts`.
 *
 * The rules behind locating and launching a user-installed `dsh` are almost
 * entirely about Windows, while the client is developed and integration-tested
 * on macOS. Because those functions take the platform as a parameter, both
 * branches are assertable from any host — this is the Windows coverage that
 * does not need a Windows machine.
 *
 * It deliberately does NOT cover process-tree semantics (that `taskkill /T /F`
 * walked from a live parent reaches the server behind a cmd.exe wrapper). Only
 * `scripts/check-installed-runtime.mjs` on a real Windows host proves that.
 *
 * The module is bundled through esbuild rather than imported directly, so this
 * check does not depend on the host Node's TypeScript stripping.
 * @module desktop/scripts/check-runtime-resolution
 */

import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const outDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-resolution-'))
process.on('exit', () => { rmSync(outDir, { recursive: true, force: true }) })

const outfile = join(outDir, 'runtime-resolution.mjs')
await esbuild.build({
  entryPoints: [join(APP_DIR, 'src', 'main', 'runtime-resolution.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
})
const {
  executableCandidates,
  isSameDirectory,
  normalizePathEntry,
  spawnTargetFor,
  parseVersionOutput,
  npxCacheRoot,
} = await import(pathToFileURL(outfile).href)

const failures = []
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail === undefined ? '' : ' — ' + detail))
  if (!ok) failures.push(name)
}
const equal = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    JSON.stringify(actual) + (JSON.stringify(actual) === JSON.stringify(expected) ? '' : ' ≠ ' + JSON.stringify(expected)))

console.log('\n# executableCandidates')
equal('Windows offers only what spawn can execute, .exe first',
  executableCandidates('dsh', 'win32'), ['dsh.exe', 'dsh.cmd', 'dsh.bat'])
// The extension-less shim npm writes on Windows is a POSIX shell script, and
// .ps1 cannot be run through cmd.exe: offering either resolves a command that
// then fails on every launch.
check('Windows never offers the extension-less npm shim',
  !executableCandidates('dsh', 'win32').includes('dsh'))
check('Windows never offers .ps1',
  !executableCandidates('dsh', 'win32').some(entry => entry.endsWith('.ps1')))
equal('POSIX looks for the bare name only', executableCandidates('dsh', 'darwin'), ['dsh'])
equal('POSIX is the same on Linux', executableCandidates('dsh', 'linux'), ['dsh'])

console.log('\n# normalizePathEntry')
equal('surrounding quotes are stripped', normalizePathEntry('"C:\\Program Files\\nodejs"'), 'C:\\Program Files\\nodejs')
equal('whitespace is trimmed', normalizePathEntry('  /usr/local/bin  '), '/usr/local/bin')
equal('a quoted entry with padding is handled', normalizePathEntry('  "C:\\tools"  '), 'C:\\tools')
equal('an unquoted entry is untouched', normalizePathEntry('/opt/homebrew/bin'), '/opt/homebrew/bin')
equal('an empty entry stays empty', normalizePathEntry('   '), '')
// Only a matched surrounding pair is removed; a stray quote is part of the name.
equal('an unbalanced quote is left alone', normalizePathEntry('"C:\\tools'), '"C:\\tools')

// The client's node shim directory is excluded from every PATH lookup. Each
// spelling below is a way a user-written PATH entry names that same directory
// while differing from the client's own `join()` output — and a miss returns
// the shim as a "user-installed" Node.
console.log('\n# isSameDirectory')
const shim = 'C:\\Users\\a\\.dsh-desktop\\bin'
check('Windows ignores case', isSameDirectory('c:\\users\\a\\.dsh-desktop\\BIN', shim, 'win32'))
check('Windows accepts forward slashes', isSameDirectory('C:/Users/a/.dsh-desktop/bin', shim, 'win32'))
check('Windows ignores a trailing separator', isSameDirectory(shim + '\\', shim, 'win32'))
check('Windows ignores a trailing forward slash', isSameDirectory('C:/Users/a/.dsh-desktop/bin/', shim, 'win32'))
check('Windows still separates different directories',
  !isSameDirectory('C:\\Users\\a\\.dsh-desktop\\bin2', shim, 'win32'))
check('Windows keeps a root from collapsing into a drive-relative path',
  isSameDirectory('C:\\', 'c:/', 'win32'))
const posixShim = '/Users/a/.dsh-desktop/bin'
check('POSIX ignores a trailing separator', isSameDirectory(posixShim + '/', posixShim, 'darwin'))
// A POSIX filesystem may hold both spellings as different directories, so the
// case fold must NOT travel off Windows.
check('POSIX stays case-sensitive', !isSameDirectory('/Users/a/.dsh-desktop/BIN', posixShim, 'darwin'))
check('POSIX does not treat a backslash as a separator',
  !isSameDirectory('/Users/a/.dsh-desktop\\bin', posixShim, 'linux'))
check('POSIX keeps the root', isSameDirectory('/', '/', 'linux'))

console.log('\n# spawnTargetFor')
const cmd = spawnTargetFor('C:\\Users\\a b\\AppData\\npm\\dsh.cmd', 'win32')
check('a Windows .cmd shim goes through the shell', cmd.shell === true, String(cmd.shell))
check('a shell target is quoted for the shell to re-parse',
  cmd.command === '"C:\\Users\\a b\\AppData\\npm\\dsh.cmd"', cmd.command)
const bat = spawnTargetFor('C:\\tools\\dsh.bat', 'win32')
check('a .bat shim also goes through the shell', bat.shell === true, String(bat.shell))
const upper = spawnTargetFor('C:\\tools\\DSH.CMD', 'win32')
check('the extension test is case-insensitive', upper.shell === true, String(upper.shell))
const exe = spawnTargetFor('C:\\tools\\dsh.exe', 'win32')
check('a real .exe is spawned directly', exe.shell === false, String(exe.shell))
// Without a shell to strip them, quotes would become part of the filename.
check('a directly spawned target is never quoted', exe.command === 'C:\\tools\\dsh.exe', exe.command)
const posix = spawnTargetFor('/usr/local/bin/dsh', 'darwin')
check('POSIX never uses a shell', posix.shell === false, String(posix.shell))
check('POSIX passes the path through unquoted', posix.command === '/usr/local/bin/dsh', posix.command)
// A POSIX file may legitimately be named `.cmd`; the shell rule is Windows-only.
const posixCmd = spawnTargetFor('/usr/local/bin/dsh.cmd', 'linux')
check('a .cmd name on POSIX still needs no shell', posixCmd.shell === false, String(posixCmd.shell))

console.log('\n# parseVersionOutput')
equal('the bundled runtime\'s real output', parseVersionOutput('0.1.0-rc.6\n'), '0.1.0-rc.6')
equal('a leading v is dropped', parseVersionOutput('v1.2.3\n'), '1.2.3')
equal('a name-prefixed version is accepted', parseVersionOutput('dsh 0.2.0\n'), '0.2.0')
equal('a slash-and-suffix format is accepted', parseVersionOutput('dsh/0.3.1 darwin-arm64\n'), '0.3.1')
equal('leading blank lines are skipped', parseVersionOutput('\n\n  1.0.0\n'), '1.0.0')
equal('the first version-shaped line wins', parseVersionOutput('banner\n2.0.0\n3.0.0\n'), '2.0.0')
equal('output with no version is rejected', parseVersionOutput('command not found\n'), undefined)
equal('empty output is rejected', parseVersionOutput(''), undefined)

console.log('\n# npxCacheRoot')
// The official instruction is `npx @deepseek-ai/dsh web` on BOTH platforms, so
// the cache is the runtime most users actually have — and npm puts it in a
// different place on each.
equal('POSIX uses ~/.npm/_npx',
  npxCacheRoot('darwin', {}, '/Users/x'), '/Users/x/.npm/_npx')
equal('Linux uses the same POSIX location',
  npxCacheRoot('linux', {}, '/home/x'), '/home/x/.npm/_npx')
equal('Windows uses %LOCALAPPDATA%\\npm-cache',
  npxCacheRoot('win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'C:\\Users\\x'),
  'C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx')
equal('npm_config_cache overrides POSIX',
  npxCacheRoot('darwin', { npm_config_cache: '/custom/cache' }, '/Users/x'), '/custom/cache/_npx')
equal('npm_config_cache overrides Windows',
  npxCacheRoot('win32', { npm_config_cache: 'D:\\cache', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'C:\\Users\\x'),
  'D:\\cache\\_npx')
equal('the uppercase spelling is honoured too',
  npxCacheRoot('darwin', { NPM_CONFIG_CACHE: '/custom/cache' }, '/Users/x'), '/custom/cache/_npx')
// Nothing to search is a miss, never a guess at some other directory.
equal('Windows without LOCALAPPDATA yields nothing',
  npxCacheRoot('win32', {}, 'C:\\Users\\x'), undefined)
equal('POSIX without a home yields nothing', npxCacheRoot('darwin', {}, ''), undefined)
equal('an empty override falls through to the default',
  npxCacheRoot('darwin', { npm_config_cache: '' }, '/Users/x'), '/Users/x/.npm/_npx')

if (failures.length > 0) {
  console.error('\n' + String(failures.length) + ' check(s) failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('\nAll runtime-resolution checks passed (' + String(process.platform) + ' host, both platform branches).')
