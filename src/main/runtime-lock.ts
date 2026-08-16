/**
 * The record of this client's managed `dsh web` child, kept in DSH_HOME.
 *
 * Two harnesses appending to one session store corrupt it: each carries its
 * own in-memory sequence number, so the log gains duplicate seqs and orphan
 * inbox splices, and an affected session never resumes again. The client
 * cannot discover every harness on the machine to avoid that — the official
 * web app takes its port from a `--port` flag OR from the profile's patch
 * layer, and the latter leaves nothing on the command line to find — so
 * exclusion must not rest on discovery.
 *
 * What the client can do reliably is never run two of its OWN runtimes. This
 * record names the child it spawned and the origin that child serves, so the
 * next start adopts the survivor (one harness, sessions shared) instead of
 * spawning beside it. That survivor is not hypothetical: a Windows installer
 * that kills the app by name leaves the child running, and the updated app
 * then starts a second writer against the same DSH_HOME.
 *
 * The record is advisory and self-healing. A child that neither answers nor
 * exists is cleared rather than obeyed, so a crashed client cannot wedge the
 * next start. It is written through a temporary file and renamed, because a
 * torn read would parse as "no runtime" — the one wrong answer that costs
 * data rather than convenience.
 * @module dsh-desktop/runtime-lock
 */

import { renameSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One managed runtime, as the next start needs to reason about it. */
export interface RuntimeLock {
  /** The `dsh web` child this client spawned. */
  childPid: number
  /** The client that spawned it; informational, for diagnosing a survivor. */
  desktopPid: number
  /** Epoch ms of the spawn. */
  startedAt: number
  /** The origin the child serves, once it has reported readiness. */
  url?: string
}

/** The record lives beside the session store it protects. */
export function runtimeLockFile(home: string): string {
  return join(home, '.dsh-desktop-runtime.json')
}

/**
 * The recorded runtime, or undefined when there is none to reason about.
 * Unreadable and malformed records read as "none": the caller's next step is
 * to probe and to check the pid, and both answer safely for a record that
 * cannot be trusted anyway.
 */
export function readRuntimeLock(home: string): RuntimeLock | undefined {
  let raw: string
  try {
    raw = readFileSync(runtimeLockFile(home), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeLock>
    if (!Number.isSafeInteger(parsed.childPid) || Number(parsed.childPid) <= 0) return undefined
    return {
      childPid: Number(parsed.childPid),
      desktopPid: Number(parsed.desktopPid ?? 0),
      startedAt: Number(parsed.startedAt ?? 0),
      ...typeof parsed.url === 'string' && parsed.url !== '' && { url: parsed.url },
    }
  } catch {
    return undefined
  }
}

/**
 * Record a freshly spawned child. Written before the child reports readiness,
 * so a client killed during boot still leaves the pid behind to be reaped.
 */
export function writeRuntimeLock(home: string, lock: RuntimeLock): void {
  const file = runtimeLockFile(home)
  const temporary = file + '.' + String(process.pid) + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(lock), { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    console.warn('[desktop] could not record the local runtime: ' + describe(error))
    try { unlinkSync(temporary) } catch { /* nothing to clean up */ }
  }
}

/**
 * Attach the served origin, so the next start can adopt this child.
 *
 * `childPid` is what the caller believes is running. A record naming anything
 * else belongs to a different child — this is a read-modify-write, and writing
 * an origin onto a record this readiness does not describe would point the next
 * start at the wrong harness.
 */
export function recordRuntimeLockUrl(home: string, url: string, childPid: number | undefined): void {
  const lock = readRuntimeLock(home)
  if (lock === undefined || lock.childPid !== childPid) return
  writeRuntimeLock(home, { ...lock, url })
}

/** Drop the record once the child is gone; absence means "nothing running". */
export function clearRuntimeLock(home: string): void {
  try {
    unlinkSync(runtimeLockFile(home))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.warn('[desktop] could not clear the runtime record: ' + describe(error))
  }
}

/**
 * Whether a pid names a live process. EPERM is a live process this user may
 * not signal, which for the caller's purpose — is something still there —
 * counts as alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
