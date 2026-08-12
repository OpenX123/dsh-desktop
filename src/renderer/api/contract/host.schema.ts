/**
 * host domain zod schemas of the public /api wire contract (vendored,
 * self-contained).
 * @module desktop/renderer/api/contract/host.schema
 */

import { z } from 'zod'

/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number().int().nonnegative(),
  canOpenPath: z.boolean(),
})

/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
  path: z.string().nullable(),
})
