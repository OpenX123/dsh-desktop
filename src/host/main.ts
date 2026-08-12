/**
 * Harness child boot for the desktop client.
 *
 * This process is the desktop client's own runtime: it composes the harness
 * CORE (the base bundle) with the desktop overlay patch, mounts the desktop
 * glue plugin programmatically, and serves the client's renderer over a
 * loopback HTTP carrier. It deliberately never boots the `dsh` web profile:
 * no web-app bundle, no client-plugin roster, no web surface prompt — the
 * client is an independent product that shares only the harness core and the
 * transport seam.
 *
 * The Electron main process spawns this script (plain Node + tsx in dev) and
 * reads the readiness line (`dsh-desktop: <url>`) from stdout.
 * @module @deepseek-ai/dsh-desktop/host
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boot,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadLayeredEnv,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { DSH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-paths'
import { desktopGlue } from './glue.ts'

/** This app's package.json, as the module-resolution anchor for profiles and bundles. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** The desktop overlay patch shipped beside this script. */
const DESKTOP_PATCH = fileURLToPath(new URL('../../overlay/desktop.cordis.patch.yml', import.meta.url))

const NAME = 'harness-desktop'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# desktop client profile root — an empty entry list; the tree is composed as
# patches: the base bundle, then this profile's cordis.patch.yml.
[]
`

// Assigned a usable default before boot so a plugin requesting exit during
// activation can never hit a temporal-dead-zone reference; swapped for the
// disposal-aware controller once the tree settles.
let shutdown: (code: number) => Promise<void> = (code) => { process.exit(code) }

async function main(): Promise<void> {
  const environment = loadLayeredEnv(NAME)
  // Bundle and plugin names resolve through the healed flat fallback mirroring
  // THIS app's dependency closure — not the dsh CLI's.
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profileDir = resolveProfileDir('desktop')
  // Auto-initialize on first use, like the shipped dsh profiles: base bundle
  // layer plus the user's own patch layer.
  initProfile(profileDir, ['@deepseek-ai/dsh-base'])
  const profile = loadProfile(NAME, 'desktop', INSTALL_ANCHOR)
  // The root is always rewritten: the whole composition is patch layers, and
  // the Loader's tree write-back would otherwise bake composed rows into it.
  writeFileSync(join(profileDir, 'cordis.yml'), PROFILE_ROOT_CONFIG)

  const overlays = loadOverlayPatches(NAME, DESKTOP_PATCH)
  const homePatches = loadOptionalPatches(NAME, join(resolveDshHome(), PROFILE_PATCH_FILENAME)) ?? []
  const patches = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...profile.patches,
    ...homePatches,
    ...overlays,
  ]

  const ctx = await boot(NAME, join(profileDir, 'cordis.yml'), patches, (hostCtx) => {
    // Before any config-tree entry mounts: the frozen environment snapshot,
    // the command line (the main process passes --port), and the desktop
    // glue plugin (it provides `desktopStartup` and mounts the /app route).
    hostCtx.provide(DSH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, {
      args: process.argv.slice(2),
      exit: code => void shutdown(code),
    })
    void hostCtx.plugin(desktopGlue)
  })

  shutdown = async (code: number): Promise<void> => {
    await ctx.fiber.dispose().catch(() => undefined)
    process.exit(code)
  }
  process.on('SIGTERM', () => { void shutdown(0) })
  process.on('SIGINT', () => { void shutdown(130) })
  installFailLoud(NAME, process, async () => { await ctx.fiber.dispose().catch(() => undefined) })

  // The desktop glue prints the readiness line once the carrier is up.
  await ctx.get('loader')?.await()
}

void main().catch((error: unknown) => {
  console.error(`${NAME}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
