/**
 * Application store: connection lifecycle, catalog refresh, session
 * conversation state, composer/model state, and the approval/question
 * pending tables. Owns the two downlink streams (mux + host) with reconnect.
 * @module desktop/renderer/state/store
 */

import { create } from 'zustand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type {
  HostFrame, MuxFrame,
} from '@deepseek-ai/dsh-host-apiproxy/api/events'
import type {
  SessionModels, SessionSummary,
} from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { WorkspaceView, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { CommandDescriptor } from '@deepseek-ai/dsh-host-apiproxy/api/commands'
import type { SkillEntry } from '@deepseek-ai/dsh-host-apiproxy/api/skills'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets'
import type { GoalRef } from '@deepseek-ai/dsh-host-apiproxy/api/goals'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-interaction/types'
import { DesktopApiClient } from '../api/client'
import { emptySession, foldEvent, type SessionUi } from './fold'

/** One pending approval (answerable frame; rpcId is stable across replays). */
export interface PendingApproval {
  rpcId: RpcId
  sessionId: SessionId
  toolName: string
  callId?: string
  reason?: string
}

/** One pending ask-user question batch. */
export interface PendingQuestion {
  rpcId: RpcId
  sessionId: SessionId
  questions: AskUserQuestionItem[]
}

/** Workspace facts for the composer context bar (served by the host glue). */
export interface ContextInfo {
  path: string
  branch?: string
  exists: boolean
}

/** One draft image attachment waiting in the composer. */
export interface DraftImage {
  name: string
  mediaType: string
  data: string
}

/** The client's local goal chip state (the goal domain has no projection). */
export interface GoalState {
  objective: string
  phase: 'active' | 'paused'
  ref: GoalRef
}

export type Phase = 'connecting' | 'ready' | 'error'

interface AppStore {
  phase: Phase
  error: string | null
  api: DesktopApiClient | null
  host: {
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  } | null

  workspaces: WorkspaceView[]
  archivedSessionIds: SessionId[]
  sessions: SessionSummary[]
  conversations: Record<string, SessionUi>

  activeSessionId: SessionId | null
  activeWorkspaceId: WorkspaceId | null
  pinned: WorkspaceId[]

  draft: string
  draftImages: DraftImage[]
  settingsOpen: boolean
  approvals: PendingApproval[]
  questions: PendingQuestion[]
  models: SessionModels | null
  context: ContextInfo | null

  /** Content search results (null = no active query). */
  searchResults: { sessionId: SessionId; snippet: string }[] | null
  /** Slash-command and skill catalogs for the composer menu. */
  commands: readonly CommandDescriptor[]
  skills: readonly SkillEntry[]
  /** Agent-preset roster and the client-side default for new sessions. */
  presets: readonly AgentPresetEntry[]
  defaultPreset: string | null
  /** The session's permission preset, as last reported/selected. */
  permissionPreset: string
  /** The client's goal chip. */
  goal: GoalState | null

  boot(): void
  refresh(): Promise<void>
  openSession(sessionId: SessionId): Promise<void>
  newSession(workspaceId?: WorkspaceId): Promise<void>
  deleteSession(sessionId: SessionId): Promise<void>
  forkSession(sessionId: SessionId, atSeq?: number): Promise<void>
  send(): Promise<void>
  stop(): void
  selectModel(provider: string, model: string, reasoningEffort?: string): Promise<void>
  respondApproval(index: number, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion(index: number, answers: { id: string; selected: string[]; custom?: string }[]): Promise<void>
  setDraft(draft: string): void
  addImage(image: DraftImage): void
  removeImage(name: string): void
  setSettingsOpen(open: boolean): void
  setPermissionPreset(name: string): void
  togglePin(workspaceId: WorkspaceId): void
  pickWorkspace(): Promise<void>
  refreshContext(): Promise<void>
  search(query: string): Promise<void>
  refreshCatalogs(): Promise<void>
  refreshPresets(): Promise<void>
  setDefaultPreset(id: string | null): void
  updateQueueItem(itemId: string, action: { kind: 'edit'; text: string } | { kind: 'remove' } | { kind: 'steer' }): Promise<void>
  setFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void>
  createGoal(objective: string, maxGoalRounds?: number): Promise<void>
  pauseGoal(): Promise<void>
  resumeGoal(): Promise<void>
  completeGoal(): Promise<void>
  togglePlan(): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** History page size for the conversation fold. */
const HISTORY_MAX_MESSAGES = 300

/** The permission presets the host /permission command accepts. */
export const PERMISSION_PRESETS: { name: string; label: string }[] = [
  { name: 'read-only', label: '只读' },
  { name: 'workspace-write', label: '工作区可写' },
  { name: 'danger-full-access', label: '完全访问' },
]

export const useApp = create<AppStore>((set, get) => {
  /** Fold one mux frame into the store. `rpcId` is the envelope's (answerable frames echo it). */
  function handleMux(frame: MuxFrame, envelopeRpcId: RpcId): void {
    switch (frame.type) {
      case 'session/event': {
        const state = get()
        const conv = state.conversations[frame.sessionId] ?? emptySession(frame.sessionId)
        foldEvent(conv, frame.event)
        set({
          conversations: { ...state.conversations, [frame.sessionId]: { ...conv } },
        })
        break
      }
      case 'session/subscribed': {
        const conv = get().conversations[frame.sessionId]
        if (conv !== undefined && conv.lastSeq < frame.lastSeq) {
          void loadHistory(frame.sessionId)
        }
        break
      }
      case 'approval/requested': {
        const state = get()
        const item: PendingApproval = {
          rpcId: envelopeRpcId,
          sessionId: frame.sessionId,
          toolName: frame.toolName,
          ...frame.callId !== undefined && { callId: frame.callId },
          ...frame.reason !== undefined && { reason: frame.reason },
        }
        set({ approvals: [...state.approvals, item] })
        break
      }
      case 'approval/resolved': {
        set({ approvals: get().approvals.filter(item => String(item.rpcId) !== String(frame.approvalId)) })
        break
      }
      case 'question/requested': {
        set({
          questions: [...get().questions, { rpcId: envelopeRpcId, sessionId: frame.sessionId, questions: frame.questions }],
        })
        break
      }
      case 'question/resolved': {
        set({ questions: get().questions.filter(item => item.rpcId !== frame.questionRpcId) })
        break
      }
      case 'session/queue': {
        const state = get()
        const conv = state.conversations[frame.sessionId] ?? emptySession(frame.sessionId)
        set({
          conversations: { ...state.conversations, [frame.sessionId]: { ...conv, queue: frame.items } },
        })
        break
      }
      case 'session/tasks': {
        const state = get()
        const conv = state.conversations[frame.sessionId] ?? emptySession(frame.sessionId)
        set({
          conversations: { ...state.conversations, [frame.sessionId]: { ...conv, tasks: frame.tasks } },
        })
        break
      }
      case 'session/projection': {
        const state = get()
        const conv = state.conversations[frame.sessionId]
        if (conv === undefined) break
        if (frame.key === 'title' && typeof frame.value === 'string') {
          set({ conversations: { ...state.conversations, [frame.sessionId]: { ...conv, title: frame.value } } })
        } else if (frame.key === 'plan' && typeof frame.value === 'object' && frame.value !== null) {
          const plan = frame.value as { active?: boolean }
          set({
            conversations: {
              ...state.conversations,
              [frame.sessionId]: { ...conv, planActive: plan.active === true },
            },
          })
        }
        break
      }
      case 'stream/error':
        console.error('[desktop] stream error:', frame.error)
        break
    }
  }

  /** Fold one host frame into the store. */
  function handleHost(frame: HostFrame): void {
    switch (frame.type) {
      case 'host/session-added':
        void get().refresh()
        break
      case 'host/session-removed': {
        const state = get()
        const { [frame.sessionId]: _removed, ...remaining } = state.conversations
        set({
          conversations: remaining,
          ...state.activeSessionId === frame.sessionId && { activeSessionId: null },
        })
        void state.refresh()
        break
      }
      case 'host/session-status': {
        const state = get()
        const conv = state.conversations[frame.sessionId]
        if (conv !== undefined) {
          set({ conversations: { ...state.conversations, [frame.sessionId]: { ...conv, running: frame.running } } })
        }
        break
      }
      case 'host/agent-error': {
        const state = get()
        const conv = state.conversations[frame.sessionId]
        if (conv !== undefined) {
          set({ conversations: { ...state.conversations, [frame.sessionId]: { ...conv, error: frame.message } } })
        }
        break
      }
      case 'host/workspace-changed':
      case 'host/workspace-removed':
      case 'host/archived-sessions-changed':
        void get().refresh()
        break
      default:
        // Merge-extensible host frame union: unknown types keep the store
        // unchanged (the documented default for every consumer).
        break
    }
  }

  /** Reload one session's history from the durable log (rebuild fold). */
  async function loadHistory(sessionId: SessionId): Promise<void> {
    const api = get().api
    if (api === null) return
    const response = await api.sessions.history({ sessionId, maxMessages: HISTORY_MAX_MESSAGES })
    if (!response.result.ok) return
    const { events, projections } = response.result.value
    const state = get()
    const previous = state.conversations[sessionId]
    const conv = previous !== undefined ? { ...previous, messages: [], streaming: null, error: null } : emptySession(sessionId)
    for (const entry of events) foldEvent(conv, entry.event)
    if (previous !== undefined) conv.running = previous.running
    const projectedTitle = (projections?.values as Record<string, unknown> | undefined)?.title
    if (typeof projectedTitle === 'string') conv.title = projectedTitle
    set({ conversations: { ...state.conversations, [sessionId]: conv } })
  }

  /** Subscribe both downlink streams with reconnect. The generators end on
   * socket close; each loop reopens after a short pause. Streams live for the
   * application lifetime, so neither loop has a termination path. */
  function runStreams(): void {
    const api = get().api
    if (api === null) return
    void (async () => {
      while (true) {
        try {
          for await (const frame of api.events.mux({}, new AbortController().signal)) {
            handleMux(frame.payload, frame.rpcId)
          }
        } catch (error) {
          console.warn('[desktop] mux stream dropped:', error)
        }
        await sleep(600)
      }
    })()
    void (async () => {
      while (true) {
        try {
          for await (const frame of api.events.host({}, new AbortController().signal)) {
            handleHost(frame.payload)
          }
        } catch (error) {
          console.warn('[desktop] host stream dropped:', error)
        }
        await sleep(600)
      }
    })()
  }

  return {
    phase: 'connecting',
    error: null,
    api: null,
    host: null,
    workspaces: [],
    archivedSessionIds: [],
    sessions: [],
    conversations: {},
    activeSessionId: null,
    activeWorkspaceId: null,
    pinned: [],
    draft: '',
    draftImages: [],
    settingsOpen: false,
    approvals: [],
    questions: [],
    models: null,
    context: null,
    searchResults: null,
    commands: [],
    skills: [],
    presets: [],
    defaultPreset: null,
    permissionPreset: 'workspace-write',
    goal: null,

    boot(): void {
      const api = new DesktopApiClient()
      set({ api })
      void (async () => {
        try {
          const describe = await api.host.describe({})
          if (!describe.result.ok) throw new Error(describe.result.error.message)
          set({ host: describe.result.value })
        } catch (error) {
          set({ phase: 'error', error: `无法连接本地运行时：${error instanceof Error ? error.message : String(error)}` })
          return
        }
        set({ phase: 'ready' })
        runStreams()
        void get().refresh()
        void get().refreshPresets()
      })()
    },

    async refresh(): Promise<void> {
      const api = get().api
      if (api === null) return
      const [list, workspaceList] = await Promise.all([
        api.sessions.list({}),
        api.workspace.list({}),
      ])
      if (list.result.ok && workspaceList.result.ok) {
        const sessions = list.result.value.items.filter(item => !item.blank && item.origin !== 'subagent')
        set({
          sessions,
          workspaces: workspaceList.result.value.items,
          archivedSessionIds: workspaceList.result.value.archivedSessionIds,
        })
      }
    },

    async openSession(sessionId: SessionId): Promise<void> {
      const state = get()
      set({ activeSessionId: sessionId, activeWorkspaceId: null })
      if (state.conversations[sessionId] === undefined) {
        await loadHistory(sessionId)
      }
      void get().refreshContext()
      void get().refreshCatalogs()
    },

    async newSession(workspaceId?: WorkspaceId): Promise<void> {
      const api = get().api
      if (api === null) return
      const response = await api.sessions.create({
        ...workspaceId !== undefined && { workspaceId },
        ...get().defaultPreset !== null && { agentPreset: get().defaultPreset as string },
      })
      if (!response.result.ok) {
        console.error('[desktop] session.create failed:', response.result.error)
        return
      }
      const sessionId = response.result.value.sessionId
      set({ conversations: { ...get().conversations, [sessionId]: emptySession(sessionId) } })
      set({ activeSessionId: sessionId, ...workspaceId !== undefined && { activeWorkspaceId: workspaceId } })
      void get().refresh()
      void get().refreshContext()
      void get().refreshCatalogs()
    },

    async deleteSession(sessionId: SessionId): Promise<void> {
      // Workspace registration deletion (archive) is the host's deletion
      // surface: archive hides the session without touching its log.
      const api = get().api
      if (api === null) return
      await api.workspace.archiveSession({ sessionId })
      void get().refresh()
    },

    async forkSession(sessionId: SessionId, atSeq?: number): Promise<void> {
      const api = get().api
      if (api === null) return
      const response = await api.sessions.fork({
        sessionId,
        ...atSeq !== undefined && { atSeq },
      })
      if (!response.result.ok) return
      const childId = response.result.value.sessionId
      set({ conversations: { ...get().conversations, [childId]: emptySession(childId) } })
      set({ activeSessionId: childId, activeWorkspaceId: null })
      void get().refresh()
      void loadHistory(childId)
    },

    async send(): Promise<void> {
      const state = get()
      const text = state.draft.trim()
      const images = state.draftImages
      if ((text === '' && images.length === 0) || state.api === null) return
      let sessionId = state.activeSessionId
      if (sessionId === null) {
        // Typing without a session starts one: the composer is always sendable.
        const created = await state.api.sessions.create({
          ...get().defaultPreset !== null && { agentPreset: get().defaultPreset as string },
        })
        if (!created.result.ok) {
          console.error('[desktop] session.create failed:', created.result.error)
          return
        }
        sessionId = created.result.value.sessionId
        set({
          conversations: { ...get().conversations, [sessionId]: emptySession(sessionId) },
          activeSessionId: sessionId,
        })
        void get().refresh()
        void get().refreshCatalogs()
      }
      const content = [
        ...images.map(image => ({ type: 'image' as const, mediaType: image.mediaType as ImageMediaType, data: image.data, name: image.name })),
        ...text !== '' ? [{ type: 'text' as const, text }] : [],
      ]
      const response = await state.api.sessions.prompt({
        sessionId,
        mode: 'queue',
        content,
      })
      if (!response.result.ok) {
        // Keep the draft: the message never left the composer, the user can
        // fix it (or retry) instead of retyping.
        const conv = get().conversations[sessionId]
        if (conv !== undefined) {
          set({ conversations: { ...get().conversations, [sessionId]: { ...conv, error: response.result.error.message } } })
        }
        return
      }
      set({ draft: '', draftImages: [] })
    },

    stop(): void {
      const state = get()
      if (state.activeSessionId === null || state.api === null) return
      void state.api.sessions.cancel({ sessionId: state.activeSessionId })
    },

    async selectModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null) return
      const response = await state.api.sessions.selectModel({
        sessionId: state.activeSessionId,
        provider,
        model,
        ...reasoningEffort !== undefined && { reasoningEffort },
      })
      if (response.result.ok) {
        void refreshModels()
      }
    },

    async respondApproval(index: number, outcome: 'allowed-once' | 'rejected'): Promise<void> {
      const state = get()
      const item = state.approvals[index]
      if (item === undefined || state.api === null) return
      await state.api.respond({
        type: 'client-response',
        rpcId: item.rpcId,
        result: { ok: true, value: { sessionId: item.sessionId, approvalId: item.rpcId, outcome } },
      })
      set({ approvals: state.approvals.filter((_, i) => i !== index) })
    },

    async respondQuestion(index: number, answers: { id: string; selected: string[]; custom?: string }[]): Promise<void> {
      const state = get()
      const item = state.questions[index]
      if (item === undefined || state.api === null) return
      await state.api.respond({
        type: 'client-response',
        rpcId: item.rpcId,
        result: { ok: true, value: { sessionId: item.sessionId, answer: { answers } } },
      })
      set({ questions: state.questions.filter((_, i) => i !== index) })
    },

    setDraft(draft: string): void {
      set({ draft })
    },

    addImage(image: DraftImage): void {
      set({ draftImages: [...get().draftImages, image] })
    },

    removeImage(name: string): void {
      set({ draftImages: get().draftImages.filter(image => image.name !== name) })
    },

    setSettingsOpen(open: boolean): void {
      set({ settingsOpen: open })
    },

    setPermissionPreset(name: string): void {
      set({ permissionPreset: name })
      // The host /permission command switches the session's permission
      // preset; without an active session the selection applies once one
      // exists (the composer menu re-sends on demand).
      const sessionId = get().activeSessionId
      if (sessionId !== null) {
        void get().api?.sessions.prompt({
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: `/permission ${name}` }],
        })
      }
    },

    togglePin(workspaceId: WorkspaceId): void {
      const pinned = get().pinned
      set({ pinned: pinned.includes(workspaceId) ? pinned.filter(id => id !== workspaceId) : [...pinned, workspaceId] })
    },

    async pickWorkspace(): Promise<void> {
      const api = get().api
      if (api === null) return
      const response = await api.host.pickDirectory({})
      if (!response.result.ok) return
      const picked: string | null = response.result.value.path
      if (picked === null) return
      const created = await api.workspace.create({ path: picked })
      if (!created.result.ok) return
      set({ activeWorkspaceId: created.result.value.workspace.workspaceId })
      void get().refresh()
    },

    async refreshContext(): Promise<void> {
      const state = get()
      const workspaceId = state.activeWorkspaceId
      const workspace = workspaceId === null ? undefined : state.workspaces.find(item => item.workspaceId === workspaceId)
      const path: string | undefined = workspace?.path
      try {
        const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`
        const response = await fetch(`/desktop/context${query}`)
        set({ context: await response.json() as ContextInfo })
      } catch {
        set({ context: null })
      }
    },

    async search(query: string): Promise<void> {
      const api = get().api
      const trimmed = query.trim()
      if (api === null || trimmed === '') {
        set({ searchResults: null })
        return
      }
      const response = await api.sessions.search({ query: trimmed })
      if (response.result.ok) {
        set({ searchResults: response.result.value.items })
      }
    },

    async refreshCatalogs(): Promise<void> {
      const api = get().api
      const sessionId = get().activeSessionId
      if (api === null || sessionId === null) return
      const [commands, skills] = await Promise.all([
        api.commands.list({ sessionId }),
        api.skills.list({ sessionId }),
      ])
      if (commands.result.ok) set({ commands: commands.result.value.commands })
      if (skills.result.ok) set({ skills: skills.result.value.skills })
    },

    async refreshPresets(): Promise<void> {
      const api = get().api
      if (api === null) return
      const response = await api.agentPresets.list({})
      if (response.result.ok) {
        const presets = response.result.value.presets
        set({
          presets,
          ...get().defaultPreset === null && {
            defaultPreset: presets.find(item => item.isDefault)?.id ?? null,
          },
        })
      }
    },

    setDefaultPreset(id: string | null): void {
      set({ defaultPreset: id })
    },

    async updateQueueItem(itemId: string, action: { kind: 'edit'; text: string } | { kind: 'remove' } | { kind: 'steer' }): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null) return
      const payload = action.kind === 'edit'
        ? { kind: 'edit' as const, content: [{ type: 'text' as const, text: action.text }] }
        : action
      await state.api.sessions.updateQueue({ sessionId: state.activeSessionId, itemId: itemId as MessageId, action: payload })
    },

    async setFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null) return
      try {
        await state.api.invokeRemote('messageFeedback/put', {
          sessionId: state.activeSessionId,
          messageId,
          rating,
        })
      } catch (error) {
        console.error('[desktop] feedback failed:', error)
      }
    },

    async createGoal(objective: string, maxGoalRounds?: number): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null || objective.trim() === '') return
      const response = await state.api.goals.create({
        sessionId: state.activeSessionId,
        objective: objective.trim(),
        ...maxGoalRounds !== undefined && { maxGoalRounds },
      })
      if (response.result.ok) {
        set({ goal: { objective: objective.trim(), phase: 'active', ref: response.result.value.ref } })
      }
    },

    async pauseGoal(): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null || state.goal === null) return
      const response = await state.api.goals.pause({ sessionId: state.activeSessionId, ref: state.goal.ref })
      if (response.result.ok) set({ goal: { ...state.goal, phase: 'paused' } })
    },

    async resumeGoal(): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null || state.goal === null) return
      const response = await state.api.goals.resume({ sessionId: state.activeSessionId, ref: state.goal.ref })
      if (response.result.ok) set({ goal: { ...state.goal, phase: 'active' } })
    },

    async completeGoal(): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null || state.goal === null) return
      const response = await state.api.goals.complete({ sessionId: state.activeSessionId, ref: state.goal.ref })
      if (response.result.ok) set({ goal: null })
    },

    async togglePlan(): Promise<void> {
      const state = get()
      if (state.activeSessionId === null || state.api === null) return
      const active = state.conversations[state.activeSessionId]?.planActive ?? false
      await state.api.sessions.prompt({
        sessionId: state.activeSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: active ? '/plan off' : '/plan' }],
      })
    },
  }
})

/** Refresh the advisory model directory for the active session. */
async function refreshModels(): Promise<void> {
  const state = useApp.getState()
  if (state.activeSessionId === null || state.api === null) return
  const response = await state.api.sessions.models({ sessionId: state.activeSessionId })
  if (response.result.ok) {
    useApp.setState({ models: response.result.value })
  }
}

/** Load the model directory when a session becomes active. */
export function refreshModelsForActiveSession(): void {
  void refreshModels()
}

/** Derive the model selection label for the composer seat. */
export function modelLabel(models: SessionModels | null): string {
  if (models === null) return '模型'
  const current = models.current
  const group = models.groups.find(item => item.id === current.provider)
  const model = group?.models.find(item => item.id === current.model)
  return model?.name ?? current.model
}

/** Derive the reasoning effort label. */
export function effortLabel(models: SessionModels | null): string {
  if (models === null) return '自动'
  const current = models.current
  if (current.reasoningEffort === undefined) return '自动'
  const group = models.groups.find(item => item.id === current.provider)
  const model = group?.models.find(item => item.id === current.model)
  const effort = model?.reasoning?.efforts.find(item => item.id === current.reasoningEffort)
  return effort?.name ?? current.reasoningEffort
}
