/**
 * Unit check for `src/main/bundled-plugin.ts`.
 *
 * The seat mutates a user-shared `~/.dsh` profile. These cases pin the
 * contracts the client relies on (add / already-present / user-owned /
 * withdraw / abandon / foreign directory / missing plugin / no profile)
 * against a temporary home, without booting Electron.
 *
 * The module is bundled through esbuild rather than imported directly, so this
 * check does not depend on the host Node's TypeScript stripping.
 * @module desktop/scripts/check-bundled-plugin
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const outDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-bundled-plugin-'))
process.on('exit', () => { rmSync(outDir, { recursive: true, force: true }) })

const outfile = join(outDir, 'bundled-plugin.mjs')
await esbuild.build({
  entryPoints: [join(APP_DIR, 'src', 'main', 'bundled-plugin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
})
const {
  BUNDLED_PLUGIN_NAME,
  abandonBundledPlugin,
  seatBundledPlugin,
  withdrawBundledPlugin,
} = await import(pathToFileURL(outfile).href)

const failures = []
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail === undefined ? '' : ' — ' + detail))
  if (!ok) failures.push(name)
}

const fixtureHome = () => mkdtemp(join(tmpdir(), 'dsh-desktop-plugin-home-'))

const writeProfile = (home, manifest) => {
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
}

const readProfile = (home) => JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))

const pluginDir = join(outDir, 'plugin')
mkdirSync(pluginDir)
writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: BUNDLED_PLUGIN_NAME, version: '0.0.0-test' }) + '\n')

const emptyBundles = {
  name: 'dsh-profile-web',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
}

console.log('\n# seatBundledPlugin')
{
  const home = await fixtureHome()
  const result = seatBundledPlugin(pluginDir, home)
  check('no profile yet is not seated', result.seated === false && result.added === false,
    result.error)
}

{
  const home = await fixtureHome()
  writeProfile(home, { name: 'dsh-profile-web', private: true })
  const result = seatBundledPlugin(pluginDir, home)
  check('a profile with no bundle list is not seated', result.seated === false && result.added === false,
    result.error)
}

{
  const home = await fixtureHome()
  writeProfile(home, emptyBundles)
  const first = seatBundledPlugin(pluginDir, home)
  const bundles = readProfile(home).dsh.profile.bundles
  const link = join(home, 'profiles', 'node_modules', BUNDLED_PLUGIN_NAME)
  check('first seat adds the bundle name', first.seated === true && first.added === true)
  check('the name is in dsh.profile.bundles', bundles.includes(BUNDLED_PLUGIN_NAME),
    JSON.stringify(bundles))
  check('the official bundles stay in place', bundles[0] === '@deepseek-ai/dsh-base')
  check('a symlink (or junction) points at the closure copy',
    existsSync(link) && lstatSync(link).isSymbolicLink() && readlinkSync(link) === pluginDir)
  const leftover = existsSync(join(home, 'profiles', 'web', 'package.json.' + String(process.pid) + '.tmp'))
  check('atomic write leaves no sibling .tmp', leftover === false)
  const second = seatBundledPlugin(pluginDir, home)
  check('a second seat reports already present', second.seated === true && second.added === false)
  rmSync(home, { recursive: true, force: true })
}

{
  const home = await fixtureHome()
  writeProfile(home, {
    ...emptyBundles,
    dependencies: { [BUNDLED_PLUGIN_NAME]: '1.0.0' },
  })
  const result = seatBundledPlugin(pluginDir, home)
  const bundles = readProfile(home).dsh?.profile?.bundles ?? []
  const link = join(home, 'profiles', 'node_modules', BUNDLED_PLUGIN_NAME)
  check('a user-owned copy is reported seated and not added', result.seated === true && result.added === false)
  check('a user-owned copy is not written into bundles', !bundles.includes(BUNDLED_PLUGIN_NAME),
    JSON.stringify(bundles))
  check('a user-owned copy gets no client-owned link', existsSync(link) === false)
  rmSync(home, { recursive: true, force: true })
}

console.log('\n# ensureLink vs bundles')
{
  const home = await fixtureHome()
  writeProfile(home, emptyBundles)
  const foreign = join(home, 'profiles', 'node_modules', BUNDLED_PLUGIN_NAME)
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'package.json'), '{"name":"impostor"}\n')
  const result = seatBundledPlugin(pluginDir, home)
  const bundles = readProfile(home).dsh.profile.bundles
  check('a foreign real directory is not treated as seated', result.seated === false && result.added === false,
    result.error)
  check('a foreign real directory is not listed in bundles', !bundles.includes(BUNDLED_PLUGIN_NAME),
    JSON.stringify(bundles))
  check('a foreign real directory is left in place', existsSync(join(foreign, 'package.json')))
  rmSync(home, { recursive: true, force: true })
}

{
  const home = await fixtureHome()
  writeProfile(home, {
    ...emptyBundles,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLED_PLUGIN_NAME] } },
  })
  const foreign = join(home, 'profiles', 'node_modules', BUNDLED_PLUGIN_NAME)
  mkdirSync(foreign, { recursive: true })
  const result = seatBundledPlugin(pluginDir, home)
  const bundles = readProfile(home).dsh.profile.bundles
  check('a leftover name in front of a foreign directory is withdrawn',
    result.seated === false && !bundles.includes(BUNDLED_PLUGIN_NAME),
    JSON.stringify(bundles))
  rmSync(home, { recursive: true, force: true })
}

console.log('\n# withdraw / abandon')
{
  const home = await fixtureHome()
  writeProfile(home, emptyBundles)
  seatBundledPlugin(pluginDir, home)
  const withdrawn = withdrawBundledPlugin(home)
  const bundles = readProfile(home).dsh.profile.bundles
  const link = join(home, 'profiles', 'node_modules', BUNDLED_PLUGIN_NAME)
  check('withdraw removes the bundle name', withdrawn === true && !bundles.includes(BUNDLED_PLUGIN_NAME))
  check('withdraw leaves the link for a cheap re-seat',
    existsSync(link) && lstatSync(link).isSymbolicLink())
  check('withdraw is a no-op the second time', withdrawBundledPlugin(home) === false)
  rmSync(home, { recursive: true, force: true })
}

{
  const home = await fixtureHome()
  writeProfile(home, {
    ...emptyBundles,
    dependencies: { [BUNDLED_PLUGIN_NAME]: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLED_PLUGIN_NAME] } },
  })
  check('withdraw never touches a user-owned copy', withdrawBundledPlugin(home) === false)
  check('the user-owned name stays in bundles',
    readProfile(home).dsh.profile.bundles.includes(BUNDLED_PLUGIN_NAME))
  rmSync(home, { recursive: true, force: true })
}

{
  const home = await fixtureHome()
  writeProfile(home, emptyBundles)
  seatBundledPlugin(pluginDir, home)
  const abandoned = abandonBundledPlugin(home)
  const link = join(home, 'profiles', 'node_modules', BUNDLED_PLUGIN_NAME)
  check('abandon removes the bundle name',
    abandoned === true && !readProfile(home).dsh.profile.bundles.includes(BUNDLED_PLUGIN_NAME))
  check('abandon removes the client-owned link', existsSync(link) === false)
  rmSync(home, { recursive: true, force: true })
}

{
  const home = await fixtureHome()
  writeProfile(home, {
    ...emptyBundles,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLED_PLUGIN_NAME] } },
  })
  const missing = join(outDir, 'missing-plugin')
  mkdirSync(missing, { recursive: true })
  const result = seatBundledPlugin(missing, home)
  check('a missing plugin package is not seated', result.seated === false, result.error)
  check('a missing plugin drops a leftover bundle name',
    !readProfile(home).dsh.profile.bundles.includes(BUNDLED_PLUGIN_NAME))
  rmSync(home, { recursive: true, force: true })
}

console.log('\n# closure resolve (dev layout)')
{
  const anchor = join(APP_DIR, 'dsh-runtime', 'package.json')
  let resolved
  try {
    resolved = dirname(createRequire(anchor).resolve(BUNDLED_PLUGIN_NAME + '/package.json'))
  } catch (error) {
    resolved = undefined
    check('createRequire from dsh-runtime finds the plugin', false, String(error))
  }
  if (resolved !== undefined) {
    check('createRequire from dsh-runtime finds the plugin',
      existsSync(join(resolved, 'package.json')), resolved)
  }
}

if (failures.length > 0) {
  console.error('\n' + String(failures.length) + ' check(s) failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('\nAll bundled-plugin checks passed.')
