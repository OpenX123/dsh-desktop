/**
 * Local domain types of the public /api wire contract (mirrors of the
 * official apiproxy vocabulary, self-contained — the renderer imports no
 * harness packages). Shapes match the vendored zod schemas; brands are plain
 * string aliases because the wire carries them as strings.
 * @module desktop/renderer/api/contract/types
 */

/** Opaque session id (string on the wire). */
export type SessionId = string & { readonly __brand?: 'session-id' }

/** Opaque message id (string on the wire). */
export type MessageId = string & { readonly __brand?: 'message-id' }

/** Opaque workspace id (string on the wire). */
export type WorkspaceId = string & { readonly __brand?: 'workspace-id' }

/** Opaque task id (string on the wire). */
export type TaskId = string & { readonly __brand?: 'task-id' }

/** Opaque tool call id (string on the wire). */
export type CallId = string & { readonly __brand?: 'call-id' }

/** Raster image media types accepted by the wire prompt. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One content block (merge-extensible; unknown types pass through). */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'image'; attachment: { attachmentId: string; mediaType: ImageMediaType; bytes: number; width: number; height: number; name?: string } }
  | { type: 'tool-call'; id: CallId; name: string; arguments: string }
  | { type: 'tool-result'; toolCallId: CallId; content: ContentBlock[]; isError?: boolean }

/** One raw stream chunk from the adapter vocabulary. */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: unknown }
  | { type: 'finish'; reason: unknown; replayState?: unknown }

/** Why a turn ended (the subset the conversation fold renders). */
export type TurnEndReason =
  | { kind: 'completed' }
  | { kind: 'aborted'; reason: unknown }
  | { kind: 'blocked' }
  | { kind: 'error'; error: { message: string; code: string } }
  | { kind: 'max-tokens' }
  | { kind: 'interrupted' }

/**
 * One durable session event (strict envelope + typed data for the events the
 * fold renders; unknown types are skipped by the switch default at runtime).
 */
export type SessionEvent =
  | { type: 'turn/start'; seq: number; time: number; data: { turn: number } }
  | { type: 'turn/end'; seq: number; time: number; data: { turn: number; reason: TurnEndReason } }
  | { type: 'user/message'; seq: number; time: number; data: { id: MessageId; role: 'user'; content: ContentBlock[] } }
  | { type: 'assistant/chunk'; seq: number; time: number; data: { turn: number; step: number; chunk: StreamChunk } }
  | { type: 'assistant/message'; seq: number; time: number; data: { turn: number; step: number; message: { id: MessageId; role: 'assistant'; content: ContentBlock[] } } }
  | { type: 'tool/call'; seq: number; time: number; data: { turn: number; step: number; callId: CallId; name: string; arguments: string } }
  | { type: 'tool/result'; seq: number; time: number; data: { turn: number; step: number; message: { id: MessageId; role: 'user'; source: { kind: 'tool'; callId: CallId } }; error?: { name: string; code: string } } }
  | { type: 'session/end-seed'; seq: number; time: number; data: Record<string, never> }

/** One session summary row of session.list. */
export interface SessionSummary {
  sessionId: SessionId
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: SessionId
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: SessionProjectionsBlock
}

/** Projection baseline passthrough (values stay wide records). */
export interface SessionProjectionsBlock {
  asOfSeq: number
  values: Record<string, unknown>
}

/** One session.search result. */
export interface SessionSearchItem {
  sessionId: SessionId
  snippet: string
}

/** Complete provider/model selection. */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One adapter-owned reasoning effort. */
export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

/** Exact-model reasoning metadata. */
export interface ModelReasoning {
  efforts: ModelReasoningEffort[]
  defaultEffort?: string
}

/** One advisory model entry inside a provider group. */
export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: ModelReasoning
}

/** One successfully loaded provider group. */
export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

/** One provider-local catalog failure. */
export interface ModelCatalogFailure {
  id: string
  name: string
  message: string
}

/** session.models response value. */
export interface SessionModels {
  current: ModelSelection
  routable: boolean
  groups: ModelProviderGroup[]
  failures: ModelCatalogFailure[]
}

/** One session.history item. */
export interface HistoryEntry {
  event: SessionEvent
  view?: ToolEventView
}

/** Host-computed tool event view (interior is opaque). */
export interface ToolEventView {
  for: 'call' | 'result'
  view: { card: string } & Record<string, unknown>
}

/** One workspace row. */
export interface WorkspaceView {
  workspaceId: WorkspaceId
  path: string
  title: string
  sessionIds: SessionId[]
  createdAt: string
  updatedAt: string
}

/** One slash-command descriptor. */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint: string }
}

/** One skill catalog entry. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

/** One agent-preset roster entry. */
export interface AgentPresetEntry {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

/** The goal domain's opaque ref. */
export interface GoalRef {
  id: string
  revision: number
}

/** host.describe response value. */
export interface HostDescribe {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath: boolean
}

/** One wire background-task view. */
export interface TaskView {
  id: TaskId
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

/** One ask-user question option. */
export interface AskUserQuestionOption {
  label: string
  description?: string
}

/** One ask-user question item. */
export interface AskUserQuestionItem {
  id: string
  question: string
  header?: string
  detail?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

/** One pending queued inbox occurrence. */
export interface QueuedInboxItem {
  id: MessageId
  placement: 'queued' | 'steering' | 'context'
  message: {
    id: MessageId
    role: 'system' | 'user' | 'assistant'
    content: ContentBlock[]
    source: { kind: string }
  }
}

/** One mux-stream frame (payload slot of a ServerRequest). */
export type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent; view?: ToolEventView }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | { type: 'approval/requested'; sessionId: SessionId; approvalId: string; toolName: string; callId?: string; reason?: string }
  | { type: 'approval/resolved'; sessionId: SessionId; approvalId: string; outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' }
  | { type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
  | { type: 'question/resolved'; sessionId: SessionId; questionRpcId: string; outcome: 'answered' | 'cancelled' }
  | { type: 'session/queue'; sessionId: SessionId; items: QueuedInboxItem[] }
  | { type: 'session/tasks'; sessionId: SessionId; tasks: TaskView[] }
  | { type: 'session/projection'; sessionId: SessionId; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: unknown }

/** One host-stream frame (payload slot of a ServerRequest). */
export type HostFrame =
  | { type: 'host/session-added'; sessionId: SessionId; blank: boolean; parentSessionId?: SessionId; origin?: 'subagent'; cwd?: string; agentPreset?: string }
  | { type: 'host/session-removed'; sessionId: SessionId }
  | { type: 'host/session-status'; sessionId: SessionId; running: boolean }
  | { type: 'host/agent-error'; sessionId: SessionId; message: string }
  | { type: 'host/workspace-changed'; workspace: WorkspaceView }
  | { type: 'host/workspace-removed'; workspaceId: WorkspaceId }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: SessionId[] }
  | { type: 'host/remote-event'; event: string; args: unknown[] }
  | { type: 'stream/error'; error: unknown }