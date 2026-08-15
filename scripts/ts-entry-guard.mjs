/**
 * Post-prune invariant for scripts/prepare-runtime.mjs: no manifest in the
 * deployed runtime closure may resolve at RUNTIME to a `.ts` file the prune
 * just deleted. The closure ships no tsx/ts-node, so any runtime resolution
 * landing on TypeScript source would fail on a user's machine — possibly in a
 * lazy path the package smoke never touches. Fail at release time instead.
 *
 * `main`/`module`/`bin` resolve as-is. `exports`/`imports` leaves may only
 * name `.ts` targets under bundler/type-oriented conditions; the current
 * closure uses exactly two families — the `source` conditions (mistralai,
 * eventsource, zod's `@zod/source`) and the `standard-schema-spec` spec
 * conformance condition — none of which Node matches without an explicit
 * `--conditions`. A future dependency that ships `"main": "./index.ts"` (a
 * tsx/ts-node style package) fails here with its name and field path.
 * @module desktop/scripts/ts-entry-guard
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SOURCE_ORIENTED_CONDITION = /source|standard-schema-spec/i
const SKIPPED_DIRECTORIES = new Set(['.pnpm', '.bin', '.modules.yaml'])

export async function assertNoTsEntryPoints(modulesDirectory) {
  const walk = async (directory, root) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(path, root)
        continue
      }
      if (!entry.isFile() || entry.name !== 'package.json') continue
      let manifest
      try {
        manifest = JSON.parse(await readFile(path, 'utf8'))
      } catch {
        continue
      }
      const display = relative(root, path)
      const leaves = []
      const scan = (value, keyPath) => {
        if (typeof value === 'string') {
          if (value.endsWith('.ts') && !value.endsWith('.d.ts')) leaves.push([keyPath, value])
        } else if (value !== null && typeof value === 'object') {
          for (const key of Object.keys(value)) scan(value[key], keyPath + '.' + key)
        }
      }
      for (const field of ['main', 'module', 'bin']) {
        if (manifest[field] !== undefined) scan(manifest[field], field)
      }
      for (const field of ['exports', 'imports']) {
        if (manifest[field] !== undefined) scan(manifest[field], field)
      }
      for (const [keyPath, value] of leaves) {
        const condition = keyPath.split('.').at(-1) ?? ''
        if (SOURCE_ORIENTED_CONDITION.test(condition)) continue
        throw new Error(display + ' resolves ' + keyPath + ' to ' + value
          + ', which the .ts prune deletes — the package needs tsx/ts-node at runtime; stop pruning .ts or add this condition to SOURCE_ORIENTED_CONDITION')
      }
    }
  }
  await walk(modulesDirectory, modulesDirectory)
}
