/**
 * The desktop client's wire client: the same four-quadrant protocol contract
 * the dsh Web UI serves under /api, spoken against the client's own local
 * carrier (which reverse-proxies the Web UI origin). This client is fully
 * self-contained — it implements the public wire interface of the Web UI with
 * vendored schemas and imports nothing from the harness repository.
 * @module desktop/renderer/api/client
 */

import { z } from 'zod'
import type {
  ClientResponse,
  RpcId,
  RpcReceipt,
  RpcRequest,
  RpcResponse,
  ServerRequest,
  ServerResponse,
} from './contract/wire.ts'
import type { HostFrame, MuxFrame } from './contract/types.ts'
import { rpcReceiptSchema, serverRequestSchema, serverResponseSchema } from './contract/rpc.schema.ts'
import { hostFrameSchema, muxFrameSchema } from './contract/events.schema.ts'
import { hostDescribeValueSchema, hostPickDirectoryValueSchema } from './contract/host.schema.ts'
import {
  sessionCancelValueSchema,
  sessionCreateValueSchema,
  sessionForkValueSchema,
  sessionHistoryValueSchema,
  sessionListValueSchema,
  sessionModelsValueSchema,
  sessionPromptValueSchema,
  sessionSearchValueSchema,
  sessionSelectModelValueSchema,
  sessionUpdateQueueValueSchema,
} from './contract/sessions.schema.ts'
import {
  workspaceArchiveSessionValueSchema,
  workspaceCreateValueSchema,
  workspaceListValueSchema,
} from './contract/workspace.schema.ts'
import { commandListValueSchema } from './contract/commands.schema.ts'
import { skillListValueSchema } from './contract/skills.schema.ts'
import { agentPresetListValueSchema } from './contract/agent-presets.schema.ts'
import {
  goalCompleteValueSchema,
  goalCreateValueSchema,
  goalPauseValueSchema,
  goalResumeValueSchema,
} from './contract/goals.schema.ts'
import { llmModelsValueSchema } from './contract/llm.schema.ts'
import type {
  AgentPresetEntry,
  AskUserQuestionItem,
  CommandDescriptor,
  GoalRef,
  HostDescribe,
  ImageMediaType,
  MessageId,
  ModelProviderGroup,
  SessionId,
  SessionModels,
  SessionSearchItem,
  SessionSummary,
  SkillEntry,
  WorkspaceId,
  WorkspaceView,
} from './contract/types.ts'
import type { HistoryEntry, SessionProjectionsBlock } from './contract/types.ts'

const MUX_PATH = '/api/events.mux'
const HOST_PATH = '/api/events.host'

/** Default timeout for bounded unary calls (a hung Web UI must not leave callers pending forever). */
const DEFAULT_TIMEOUT_MS = 30_000

type Parser<F> = { parse(value: unknown): F }
type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }

/** The business payloads this client sends (mirrors of the wire request shapes). */
export type PromptContentPart = {
  type: 'text'
  text: string
} | {
  type: 'image'
  mediaType: ImageMediaType
  data: string
  name?: string
}

/** The value schema by method: the S→C second-level parse table. */
const UNARY_VALUE_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  'session.list': sessionListValueSchema,
  'session.search': sessionSearchValueSchema,
  'session.create': sessionCreateValueSchema,
  'session.history': sessionHistoryValueSchema,
  'session.models': sessionModelsValueSchema,
  'session.selectModel': sessionSelectModelValueSchema,
  'session.fork': sessionForkValueSchema,
  'session.prompt': sessionPromptValueSchema,
  'session.updateQueue': sessionUpdateQueueValueSchema,
  'session.cancel': sessionCancelValueSchema,
  'host.describe': hostDescribeValueSchema,
  'host.pickDirectory': hostPickDirectoryValueSchema,
  'workspace.list': workspaceListValueSchema,
  'workspace.create': workspaceCreateValueSchema,
  'workspace.archiveSession': workspaceArchiveSessionValueSchema,
  'command.list': commandListValueSchema,
  'skill.list': skillListValueSchema,
  'agentPreset.list': agentPresetListValueSchema,
  'goal.create': goalCreateValueSchema,
  'goal.pause': goalPauseValueSchema,
  'goal.resume': goalResumeValueSchema,
  'goal.complete': goalCompleteValueSchema,
  'llm.models': llmModelsValueSchema,
}

/**
 * The desktop client carrier: unary/respond over fetch, mux/host over
 * downlink-only WebSockets, exactly like a same-origin browser page of the
 * official Web UI — except the origin here is the client's own carrier.
 */
export class DesktopApiClient {
  private nextRpcId = 0

  /** Mint a fresh correlation id (opaque echo token). */
  private mintRpcId(): RpcId {
    return crypto.randomUUID() as RpcId
  }

  /** Same-origin base: the renderer is served by the client's own carrier. */
  private resolveBase(): string {
    const origin = globalThis.location?.origin
    return origin !== undefined && origin !== 'null' ? origin : 'http://127.0.0.1'
  }

  /** Shared POST leg: JSON body, optional default timeout merged with the caller's signal. */
  private async postJson(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    timeoutPolicy: 'default' | 'caller-signal-only' = 'default',
  ): Promise<Response> {
    const requestSignal = timeoutPolicy === 'default'
      ? signal === undefined
        ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
        : AbortSignal.any([AbortSignal.timeout(DEFAULT_TIMEOUT_MS), signal])
      : signal
    const response = await fetch(new URL(path, this.resolveBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...requestSignal === undefined ? {} : { signal: requestSignal },
    })
    if (!response.ok) throw new Error('transport failure for ' + path + ': HTTP ' + String(response.status))
    return response
  }

  /**
   * Unary protocol path: mint → POST full form → envelope parse → verify echo
   * → value parse → narrow.
   */
  private async callUnary<T>(
    method: string,
    payload: unknown,
    signal?: AbortSignal,
    timeoutPolicy: 'default' | 'caller-signal-only' = 'default',
  ): Promise<RpcResponse<T>> {
    const rpcId = this.mintRpcId()
    const response = await this.postJson(
      '/api/' + method,
      { type: 'client-request', rpcId, method, payload },
      signal,
      timeoutPolicy,
    )
    const full = serverResponseSchema.parse(await response.json())
    if (full.rpcId !== rpcId) throw new Error('rpcId mismatch for ' + method)
    if (!full.result.ok) return { rpcId: full.rpcId, result: full.result }
    const valueSchema = UNARY_VALUE_SCHEMAS[method]
    const value = valueSchema === undefined ? full.result.value : valueSchema.parse(full.result.value)
    return { rpcId: full.rpcId, result: { ok: true, value: value as T } }
  }

  /**
   * Invoke one TypeRT Host Remote endpoint (e.g. 'messageFeedback/put').
   * Remotes ride the same four-quadrant envelope as unary methods — method =
   * the remote's wire name, payload = '{ args: { request } }'.
   * @param method - the remote's wire path ('<domain>/<verb>').
   * @param request - the remote's request payload.
   * @returns the remote's response value, or throws on a business error.
   */
  async invokeRemote<T>(method: string, request: unknown): Promise<T> {
    const rpcId = this.mintRpcId()
    const message = { type: 'client-request', rpcId, method, payload: { args: { request } } } as const
    const response = await this.postJson('/api/' + method, message)
    const full: ServerResponse = serverResponseSchema.parse(await response.json())
    if (full.rpcId !== rpcId) throw new Error('rpcId mismatch for ' + method)
    if (!full.result.ok) throw new Error(String(full.result.error.message))
    // Remotes wrap the value in a second result envelope ('{ ok, value }').
    const wrapped = full.result.value as { ok: boolean; value: T } | T
    if (typeof wrapped === 'object' && wrapped !== null && 'ok' in wrapped && 'value' in wrapped) {
      if (!wrapped.ok) throw new Error(String((wrapped as { value: unknown }).value))
      return wrapped.value
    }
    return wrapped
  }

  /** Answer a server-request (approvals and questions). */
  async respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt> {
    const response = await this.postJson('/api/respond', message, signal)
    return rpcReceiptSchema.parse(await response.json())
  }

  /** Mux downlink stream (session events, approvals, questions, queues, tasks, projections). */
  eventsMux(signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readWebSocket<MuxFrame>(MUX_PATH, signal, muxFrameSchema, onOpen)
  }

  /** Host downlink stream (session registry and workspace changes). */
  eventsHost(signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readWebSocket<HostFrame>(HOST_PATH, signal, hostFrameSchema, onOpen)
  }

  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: MessageEvent): void => {
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error('[desktop] dropping malformed WebSocket frame on ' + path + ':', error)
        return
      }
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }

  // ---- typed domain surface (the methods this client actually calls) ----

  readonly sessions = {
    list: (payload: { cursor?: string }, signal?: AbortSignal): Promise<RpcResponse<{ items: SessionSummary[] }>> =>
      this.callUnary('session.list', payload, signal),
    search: (payload: { query: string }, signal?: AbortSignal): Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>> =>
      this.callUnary('session.search', payload, signal),
    create: (payload: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId; agentPreset?: string }, signal?: AbortSignal): Promise<RpcResponse<{ sessionId: SessionId; agentPreset?: string }>> =>
      this.callUnary('session.create', payload, signal),
    history: (payload: { sessionId: SessionId; beforeSeq?: number; maxMessages?: number }, signal?: AbortSignal): Promise<RpcResponse<{ events: HistoryEntry[]; hasMore: boolean; projections?: SessionProjectionsBlock }>> =>
      this.callUnary('session.history', payload, signal),
    models: (payload: { sessionId: SessionId }, signal?: AbortSignal): Promise<RpcResponse<SessionModels>> =>
      this.callUnary('session.models', payload, signal),
    selectModel: (payload: { sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal): Promise<RpcResponse<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> =>
      this.callUnary('session.selectModel', payload, signal),
    fork: (payload: { sessionId: SessionId; atSeq?: number }, signal?: AbortSignal): Promise<RpcResponse<{ sessionId: SessionId }>> =>
      this.callUnary('session.fork', payload, signal),
    prompt: (payload: { sessionId: SessionId; mode: 'queue' | 'steer'; content: PromptContentPart[]; clientTimeZone?: string }, signal?: AbortSignal): Promise<RpcResponse<{ accepted: true; command?: { kind: 'success'; text?: string } }>> =>
      this.callUnary('session.prompt', payload, signal),
    updateQueue: (payload: { sessionId: SessionId; itemId: MessageId; action: { kind: 'edit'; content: { type: string }[] } | { kind: 'remove' } | { kind: 'steer' } }, signal?: AbortSignal): Promise<RpcResponse<{ accepted: true }>> =>
      this.callUnary('session.updateQueue', payload, signal),
    cancel: (payload: { sessionId: SessionId }, signal?: AbortSignal): Promise<RpcResponse<{ accepted: true }>> =>
      this.callUnary('session.cancel', payload, signal),
  }

  readonly host = {
    describe: (payload: Record<string, never>, signal?: AbortSignal): Promise<RpcResponse<HostDescribe>> =>
      this.callUnary('host.describe', payload, signal),
    // A native system dialog is user-paced and may legitimately stay open
    // longer than the normal unary deadline.
    pickDirectory: (payload: Record<string, never>, signal?: AbortSignal): Promise<RpcResponse<{ path: string | null }>> =>
      this.callUnary('host.pickDirectory', payload, signal, 'caller-signal-only'),
  }

  readonly workspace = {
    list: (payload: Record<string, never>, signal?: AbortSignal): Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds: SessionId[] }>> =>
      this.callUnary('workspace.list', payload, signal),
    create: (payload: { path: string }, signal?: AbortSignal): Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>> =>
      this.callUnary('workspace.create', payload, signal),
    archiveSession: (payload: { sessionId: SessionId }, signal?: AbortSignal): Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>> =>
      this.callUnary('workspace.archiveSession', payload, signal),
  }

  readonly commands = {
    list: (payload: { sessionId: SessionId }, signal?: AbortSignal): Promise<RpcResponse<{ commands: CommandDescriptor[] }>> =>
      this.callUnary('command.list', payload, signal),
  }

  readonly skills = {
    list: (payload: { sessionId: SessionId }, signal?: AbortSignal): Promise<RpcResponse<{ skills: SkillEntry[] }>> =>
      this.callUnary('skill.list', payload, signal),
  }

  readonly agentPresets = {
    list: (payload: Record<string, never>, signal?: AbortSignal): Promise<RpcResponse<{ presets: AgentPresetEntry[]; authorable: boolean; hasDocument: boolean }>> =>
      this.callUnary('agentPreset.list', payload, signal),
  }

  readonly goals = {
    create: (payload: { sessionId: SessionId; objective: string; maxGoalRounds?: number }, signal?: AbortSignal): Promise<RpcResponse<{ ref: GoalRef }>> =>
      this.callUnary('goal.create', payload, signal),
    pause: (payload: { sessionId: SessionId; ref: GoalRef }, signal?: AbortSignal): Promise<RpcResponse<{ ref: GoalRef }>> =>
      this.callUnary('goal.pause', payload, signal),
    resume: (payload: { sessionId: SessionId; ref: GoalRef }, signal?: AbortSignal): Promise<RpcResponse<{ ref: GoalRef }>> =>
      this.callUnary('goal.resume', payload, signal),
    complete: (payload: { sessionId: SessionId; ref: GoalRef }, signal?: AbortSignal): Promise<RpcResponse<{ ref: GoalRef }>> =>
      this.callUnary('goal.complete', payload, signal),
  }

  readonly llm = {
    models: (payload: Record<string, never>, signal?: AbortSignal): Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: unknown[] }>> =>
      this.callUnary('llm.models', payload, signal),
  }

  readonly events = {
    mux: (payload: Record<string, never>, signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>> =>
      this.eventsMux(signal, onOpen),
    host: (payload: Record<string, never>, signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>> =>
      this.eventsHost(signal, onOpen),
  }

  /** credentials.set for the settings panel's API key (ref = the DeepSeek key env name). */
  credentials = {
    set: (payload: { ref: string; value: string }, signal?: AbortSignal): Promise<RpcResponse<unknown>> =>
      this.callUnary('credentials.set', payload, signal),
  }
}

/** The question batch type the store hands the composer overlay. */
export type { AskUserQuestionItem }
