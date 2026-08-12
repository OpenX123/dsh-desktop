/**
 * approvals domain zod schemas of the public /api wire contract (vendored,
 * self-contained). 'respond' is a client-response; the payload schema serves
 * the answer payload of approval responses.
 * @module desktop/renderer/api/contract/approvals.schema
 */

import { z } from 'zod'
import { sessionIdSchema } from './sessions.schema.ts'

/** ApprovalRequestId: one brand cast after schema validation. */
export const approvalRequestIdSchema = z.string().min(1)

/** Approval answer payload (the result.value slot of a client-response). */
export const approvalResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  approvalId: approvalRequestIdSchema,
  outcome: z.union([z.literal('allowed-once'), z.literal('rejected')]),
})
