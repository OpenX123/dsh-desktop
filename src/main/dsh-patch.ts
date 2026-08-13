/**
 * dsh Web UI patch application: overlays the client's vendored, pre-built
 * dsh Web UI artifacts onto a locally spawned `dsh web` installation.
 *
 * The desktop shell loads the OFFICIAL Web UI, which the dsh CLI serves from
 * its own installed packages. Two desktop-owned product changes live in those
 * packages (skills management settings section, the full-roster composer
 * launcher, and the skill.adminList/setEnabled/remove RPCs). Rather than
 * forking dsh, the client carries the already-BUILT patched artifacts under
 * `vendor/dsh-web-patch/` and copies them over the resolved local dsh
 * installation right before `dsh web` spawns — the runtime never builds
 * anything and needs no network or package manager.
 *
 * Only the monorepo checkout layout is patched (`<root>/packages/<pkg>/lib`),
 * which is what the development sibling-checkout resolution produces and the
 * npm-distributed CLI keeps (its bin resolves plugins through the same
 * package layout). A target whose content already equals the patched bytes
 * counts as applied; any other existing target is replaced with the patched
 * bytes after a one-time backup (`.dsh-desktop-backup`). A missing target or
 * an unrecognizable installation root is skipped loudly rather than
 * guessed — a skipped file only means that feature stays stock.
 * @module dsh-desktop/main/dsh-patch
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One vendored file: monorepo-relative target path + its content hash. */
interface PatchFile {
  path: string
  sha256: string
}

/** The vendored patch manifest (vendor/dsh-web-patch/manifest.json). */
interface PatchManifest {
  patchId: string
  layout: string
  files: PatchFile[]
}

/** The outcome of one overlay application. */
export interface PatchResult {
  /** Files copied over the installation (feature newly enabled). */
  applied: string[]
  /** Files left untouched (already patched, missing, or skipped). */
  skipped: string[]
  /** Human-readable reasons keyed by target path (skips only). */
  reasons: Record<string, string>
}

/**
 * The vendor directory, resolved from the BUILT bundle at <project>/.build/main.mjs.
 * `DSH_DESKTOP_PATCH_DIR` overrides for tests and staged rollouts.
 */
const PATCH_DIR = process.env.DSH_DESKTOP_PATCH_DIR
  ?? fileURLToPath(new URL('../vendor/dsh-web-patch/', import.meta.url))

/** Walk upward from a directory until a predicate accepts it (bounded). */
function findAncestor(start: string, predicate: (dir: string) => boolean, maxDepth = 8): string | undefined {
  let current = start
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (predicate(current)) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * Locate the dsh installation root a `dsh web` binary belongs to.
 * The sibling-checkout resolution hands the shell
 * `<checkout>/apps/cli/lib/bin.js`, so the root is the ancestor that carries
 * both `packages/` and `apps/cli`. A bundled npm distribution may only
 * expose the bin; that layout is not patched (logged as a skip).
 * @param binPath - absolute path of the resolved dsh CLI entry.
 * @returns the installation root, or undefined when the layout is unknown.
 */
function resolveDshRoot(binPath: string): string | undefined {
  const binDir = dirname(binPath)
  const root = findAncestor(binDir, (dir) => {
    if (!existsSync(join(dir, 'packages'))) return false
    if (!statSync(join(dir, 'packages')).isDirectory()) return false
    return existsSync(join(dir, 'apps', 'cli'))
  })
  return root
}

/** sha256 of one file's current bytes, or undefined when it does not exist. */
function fileHash(path: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Apply the vendored patch onto one dsh installation.
 * @param binPath - absolute path of the `dsh` CLI entry the shell will spawn.
 * @returns the per-file outcome (applied / skipped + reasons).
 */
export function applyDshWebPatch(binPath: string): PatchResult {
  const result: PatchResult = { applied: [], skipped: [], reasons: {} }
  const manifestPath = join(PATCH_DIR, 'manifest.json')
  let manifest: PatchManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PatchManifest
  } catch (error) {
    result.skipped.push('manifest.json')
    result.reasons['manifest.json'] = `patch manifest unreadable: ${String(error)}`
    return result
  }
  if (manifest.layout !== 'monorepo-relative') {
    result.skipped.push('manifest.json')
    result.reasons['manifest.json'] = `unsupported patch layout "${String(manifest.layout)}"`
    return result
  }
  const root = resolveDshRoot(binPath)
  if (root === undefined) {
    for (const file of manifest.files) result.skipped.push(file.path)
    result.reasons.root = `no monorepo dsh installation found for ${binPath}`
    return result
  }
  for (const file of manifest.files) {
    const source = join(PATCH_DIR, file.path)
    const target = join(root, file.path)
    if (!existsSync(source)) {
      result.skipped.push(file.path)
      result.reasons[file.path] = 'vendored file missing'
      continue
    }
    const current = fileHash(target)
    if (current === file.sha256) continue // already patched
    if (current !== undefined && !existsSync(target + '.dsh-desktop-backup')) {
      copyFileSync(target, target + '.dsh-desktop-backup')
    }
    try {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      result.applied.push(file.path)
    } catch (error) {
      result.skipped.push(file.path)
      result.reasons[file.path] = `copy failed: ${String(error)}`
    }
  }
  return result
}

/** Render a patch outcome as one human-readable log line. */
export function describePatchResult(result: PatchResult): string {
  if (result.applied.length === 0 && result.skipped.length === 0) return 'dsh web patch: nothing to apply'
  const parts: string[] = []
  if (result.applied.length > 0) parts.push(`applied ${result.applied.length} file(s)`)
  if (result.skipped.length > 0) {
    const reasons = Object.entries(result.reasons)
      .map(([path, reason]) => `${path}: ${reason}`)
      .join('; ')
    parts.push(`skipped ${result.skipped.length} file(s) (${reasons})`)
  }
  return `dsh web patch: ${parts.join(', ')}`
}
