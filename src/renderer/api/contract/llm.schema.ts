/**
 * llm domain zod schemas of the public /api wire contract (vendored,
 * self-contained). Only the surface actually consumed by this client:
 * llm.models (the settings model catalog).
 * @module desktop/renderer/api/contract/llm.schema
 */

import { z } from 'zod'
import { modelCatalogFailureSchema, modelProviderGroupSchema } from './sessions.schema.ts'

/** llm.models response value. */
export const llmModelsValueSchema = z.object({
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
})
