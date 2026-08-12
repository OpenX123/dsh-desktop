/**
 * skills domain zod schemas of the public /api wire contract (vendored,
 * self-contained).
 * @module desktop/renderer/api/contract/skills.schema
 */

import { z } from 'zod'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
})

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
})
