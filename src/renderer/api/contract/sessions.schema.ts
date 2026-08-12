/**
 * sessions domain zod schemas of the public /api wire contract. Vendored
 * from @deepseek-ai/dsh-host-apiproxy (same semantics, self-contained).
 * SessionEvent passthrough = strict envelope (type/seq/time) + wide data.
 * @module desktop/renderer/api/contract/sessions.schema
 */

import { z } from 'zod'
import type { HistoryEntry, MessageId, SessionEvent, SessionId, SessionSummary, WorkspaceId } from './types.ts'
import { SESSION_SEARCH_RESULT_LIMIT, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS, truncateUnicodeCodePoints } from './session-search.ts'

/** SessionId: one brand cast after schema validation. */
export const sessionIdSchema = z.string().min(1) as unknown as z.ZodType<SessionId>

/** MessageId: one brand cast after non-empty string validation. */
export const messageIdSchema = z.string().min(1) as unknown as z.ZodType<MessageId>

/** WorkspaceId: the workspace domain's one brand cast (hosted here to keep schema modules a DAG). */
export const workspaceIdSchema = z.string().min(1) as unknown as z.ZodType<WorkspaceId>

/** SessionEvent passthrough: strict envelope, wide data. */
export const sessionEventSchema = z.object({
  type: z.string(),
  seq: z.number().int().nonnegative(),
  time: z.number(),
  data: z.unknown(),
  sourceEventSeqs: z.array(z.number()).optional(),
  surfaceOp: z.unknown().optional(),
  ignorable: z.literal(true).optional(),
}) as unknown as z.ZodType<SessionEvent>

/** SessionSummary row of session.list. */
export const sessionSummarySchema = z.object({
  sessionId: sessionIdSchema,
  updatedAt: z.number(),
  running: z.boolean(),
  blank: z.boolean(),
  parentSessionId: sessionIdSchema.optional(),
  origin: z.literal('subagent').optional(),
  cwd: z.string().optional(),
  agentPreset: z.string().optional(),
  projections: z.lazy(() => { return sessionProjectionsBlockSchema }).optional(),
}) as unknown as z.ZodType<SessionSummary>

/** session.list response value. */
export const sessionListValueSchema = z.object({
  items: z.array(sessionSummarySchema),
})

/** One session.search result. */
export const sessionSearchItemSchema = z.object({
  sessionId: sessionIdSchema,
  snippet: z.string().refine(
    snippet => truncateUnicodeCodePoints(snippet, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS) === snippet,
    { message: 'search snippet must contain at most ' + String(SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS) + ' Unicode code points' },
  ),
})

/** session.search response value. */
export const sessionSearchValueSchema = z.object({
  items: z.array(sessionSearchItemSchema).max(SESSION_SEARCH_RESULT_LIMIT),
  hasMore: z.boolean(),
})

/** session.create response value. */
export const sessionCreateValueSchema = z.object({
  sessionId: sessionIdSchema,
  agentPreset: z.string().optional(),
})

/** session.fork response value. */
export const sessionForkValueSchema = z.object({
  sessionId: sessionIdSchema,
})

/** Complete provider/model selection. */
export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})

/** One adapter-owned reasoning effort. */
export const modelReasoningEffortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
})

/** Exact-model reasoning metadata. */
export const modelReasoningSchema = z.object({
  efforts: z.array(modelReasoningEffortSchema).min(1),
  defaultEffort: z.string().min(1).optional(),
})

/** One advisory model entry inside a provider group. */
export const modelCatalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  reasoning: modelReasoningSchema.optional(),
})

/** One successfully loaded provider group. */
export const modelProviderGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  models: z.array(modelCatalogModelSchema),
})

/** One provider-local catalog failure. */
export const modelCatalogFailureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  message: z.string(),
})

/** ToolEventView passthrough: lock only the 'for' discriminant. */
export const toolEventViewSchema = z.discriminatedUnion('for', [
  z.object({ for: z.literal('call'), view: z.looseObject({ card: z.string() }) }),
  z.object({ for: z.literal('result'), view: z.looseObject({ card: z.string() }) }),
])

/** One session.history item. */
export const historyEntrySchema = z.object({
  event: sessionEventSchema,
  view: toolEventViewSchema.optional(),
}) as unknown as z.ZodType<HistoryEntry>

/** Projection baseline passthrough: values stays a wide record. */
export const sessionProjectionsBlockSchema = z.object({
  // -1 = empty log (the lastSeq convention of session/subscribed).
  asOfSeq: z.number().int().min(-1),
  values: z.record(z.string(), z.unknown()),
})

/** session.history response value. */
export const sessionHistoryValueSchema = z.object({
  events: z.array(historyEntrySchema),
  hasMore: z.boolean(),
  projections: sessionProjectionsBlockSchema.optional(),
})

/** session.models response value. */
export const sessionModelsValueSchema = z.object({
  current: modelSelectionSchema,
  routable: z.boolean(),
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
})

/** session.selectModel response value. */
export const sessionSelectModelValueSchema = z.object({
  selected: modelSelectionSchema,
})

/** ContentBlock passthrough: the type discriminant envelope is strict, the rest stays wide. */
export const contentBlockSchema = z.looseObject({ type: z.string() })

/** Raster image media types accepted by the version-one browser wire. */
export const imageMediaTypeSchema = z.union([
  z.literal('image/png'),
  z.literal('image/jpeg'),
  z.literal('image/webp'),
  z.literal('image/gif'),
])

/** Prompt wire content. */
export const promptContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), mediaType: imageMediaTypeSchema, data: z.string(), name: z.string().optional() }),
])

/** session.prompt response value. */
export const sessionPromptValueSchema = z.object({
  accepted: z.literal(true),
  command: z.object({
    kind: z.literal('success'),
    text: z.string().optional(),
  }).optional(),
})

/** session.updateQueue response value. */
export const sessionUpdateQueueValueSchema = z.object({
  accepted: z.literal(true),
})

/** session.cancel response value. */
export const sessionCancelValueSchema = z.object({
  accepted: z.literal(true),
})
