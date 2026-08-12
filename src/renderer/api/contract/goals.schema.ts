/**
 * goals domain zod schemas of the public /api wire contract (vendored,
 * self-contained). Mutation-only shapes: every value schema is a '{ ref }'
 * acknowledgement.
 * @module desktop/renderer/api/contract/goals.schema
 */

import { z } from 'zod'
import type { GoalRef } from './types.ts'

/** GoalRef schema. */
export const goalRefSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
}) as unknown as z.ZodType<GoalRef>

/** Shared '{ ref }' acknowledgement value of every non-clear mutation. */
const goalRefValueSchema = z.object({ ref: goalRefSchema })

/** goal.create response value. */
export const goalCreateValueSchema = goalRefValueSchema as unknown as z.ZodType<unknown>

/** goal.pause response value. */
export const goalPauseValueSchema = goalRefValueSchema as unknown as z.ZodType<unknown>

/** goal.resume response value. */
export const goalResumeValueSchema = goalRefValueSchema as unknown as z.ZodType<unknown>

/** goal.complete response value. */
export const goalCompleteValueSchema = goalRefValueSchema as unknown as z.ZodType<unknown>
