/**
 * tasks domain zod schemas of the public /api wire contract (vendored,
 * self-contained): the branded task id and the wire view carried by
 * 'session/tasks' frames.
 * @module desktop/renderer/api/contract/tasks.schema
 */

import { z } from 'zod'
import type { TaskId } from './types.ts'

/** TaskId: one brand cast after non-empty string validation. */
export const taskIdSchema = z.string().min(1) as unknown as z.ZodType<TaskId>

/** One wire task view. 'kind' stays an open string (plugin-extensible). */
export const taskViewSchema = z.object({
  id: taskIdSchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  status: z.union([
    z.literal('running'),
    z.literal('stopping'),
    z.literal('completed'),
    z.literal('killed'),
    z.literal('failed'),
  ]),
  detail: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
})
