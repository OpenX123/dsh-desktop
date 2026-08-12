/**
 * commands domain zod schemas of the public /api wire contract (vendored,
 * self-contained).
 * @module desktop/renderer/api/contract/commands.schema
 */

import { z } from 'zod'

/** CommandDescriptor row of command.list. */
export const commandDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  input: z.object({ hint: z.string() }).optional(),
})

/** command.list response value. */
export const commandListValueSchema = z.object({
  commands: z.array(commandDescriptorSchema),
})
