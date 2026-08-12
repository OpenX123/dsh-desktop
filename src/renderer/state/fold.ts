/**
 * Session event fold: the durable `session/event` stream → conversation UI
 * state. This is the desktop client's own minimal fold over the shared wire
 * contract — committed messages, live streaming chunks, and tool rows.
 * @module desktop/renderer/state/fold
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'

/** One tool invocation row inside an assistant message. */
export interface ToolRow {
  callId: string
  name: string
  status: 'running' | 'ok' | 'error'
}

/** One committed conversation message. */
export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  tools: ToolRow[]
  time: number
}

/** Live partial state for the open (turn, step) — the streaming assistant message. */
export interface StreamingState {
  turn: number
  step: number
  text: string
  reasoning: string
  tools: ToolRow[]
}

/** One pending background task (wire TaskView, rendered by the task panel). */
export interface TaskView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
}

/** One pending queued inbox occurrence (wire QueuedInboxItem). */
export interface QueuedInboxItem {
  id: string
  placement: 'queued' | 'steering' | 'context'
  message: { id: string; content: ContentBlock[] }
}

/** The full conversation state of one session. */
export interface SessionUi {
  sessionId: SessionId
  title: string
  running: boolean
  lastSeq: number
  messages: UiMessage[]
  streaming: StreamingState | null
  error: string | null
  /** Pending queued input (authoritative `session/queue` snapshots). */
  queue: QueuedInboxItem[]
  /** Background tasks visible to this session (authoritative snapshots). */
  tasks: TaskView[]
  /** Plan mode state (the `plan` projection). */
  planActive: boolean
}

export function emptySession(sessionId: SessionId): SessionUi {
  return {
    sessionId,
    title: '新会话',
    running: false,
    lastSeq: -1,
    messages: [],
    streaming: null,
    error: null,
    queue: [],
    tasks: [],
    planActive: false,
  }
}

/** Plain text of a committed content block list (reasoning and tool blocks stay out of the text face). */
export function blocksToText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'image':
        parts.push('［图片］')
        break
      default:
        break
    }
  }
  return parts.join('').trim()
}

/** Accumulate one raw stream chunk into the streaming state. */
export function foldChunk(state: StreamingState, chunk: StreamChunk): void {
  switch (chunk.type) {
    case 'text-delta':
      state.text += chunk.text
      break
    case 'reasoning-delta':
      state.reasoning += chunk.text
      break
    case 'tool-call-delta': {
      const existing = state.tools.find(tool => tool.callId === chunk.id)
      if (existing !== undefined) {
        if (chunk.name !== undefined) existing.name = chunk.name
      } else {
        state.tools.push({ callId: chunk.id, name: chunk.name ?? 'tool', status: 'running' })
      }
      break
    }
    default:
      break
  }
}

/**
 * Fold one durable event into the conversation state. Committed messages
 * append; the open step's chunks accumulate in `streaming` until the
 * `assistant/message` closes it.
 */
export function foldEvent(state: SessionUi, event: SessionEvent): void {
  state.lastSeq = event.seq
  switch (event.type) {
    case 'turn/start':
      state.running = true
      state.error = null
      break
    case 'turn/end': {
      state.running = false
      if (event.data.reason.kind === 'error') {
        state.error = event.data.reason.error.message
      }
      break
    }
    case 'user/message': {
      const text = blocksToText(event.data.content)
      if (text === '') return
      state.messages.push({
        id: event.data.id,
        role: 'user',
        text,
        tools: [],
        time: event.time,
      })
      break
    }
    case 'assistant/chunk': {
      const { turn, step } = event.data
      if (state.streaming === null || state.streaming.turn !== turn || state.streaming.step !== step) {
        state.streaming = { turn, step, text: '', reasoning: '', tools: [] }
      }
      foldChunk(state.streaming, event.data.chunk)
      break
    }
    case 'tool/call': {
      if (state.streaming === null) state.streaming = { turn: event.data.turn, step: event.data.step, text: '', reasoning: '', tools: [] }
      state.streaming.tools.push({ callId: event.data.callId, name: event.data.name, status: 'running' })
      break
    }
    case 'tool/result': {
      const tool = state.streaming?.tools.find(item => item.callId === event.data.message.source.callId)
      if (tool !== undefined) tool.status = event.data.error !== undefined ? 'error' : 'ok'
      break
    }
    case 'assistant/message': {
      const { turn, step, message } = event.data
      const open = state.streaming
      if (open !== null && open.turn === turn && open.step === step) {
        state.messages.push({
          id: message.id,
          role: 'assistant',
          text: open.text,
          ...open.reasoning !== '' && { reasoning: open.reasoning },
          tools: open.tools,
          time: event.time,
        })
        state.streaming = null
      } else {
        const text = blocksToText(message.content)
        if (text === '' && state.streaming === null) break
        if (state.streaming !== null) {
          state.messages.push({
            id: message.id,
            role: 'assistant',
            text: text !== '' ? text : state.streaming.text,
            ...state.streaming.reasoning !== '' && { reasoning: state.streaming.reasoning },
            tools: state.streaming.tools,
            time: event.time,
          })
          state.streaming = null
        }
      }
      break
    }
    default:
      break
  }
}
