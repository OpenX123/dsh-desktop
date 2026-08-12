/**
 * The floating composer dock: the context bar (project / Local / git branch)
 * above a rounded composer with the textarea row and the action row
 * (attachment + permission preset on the left; model, reasoning, voice, and
 * the black primary button on the right). Also hosts the slash-command menu,
 * the queue rows, and the goal/plan chips.
 * @module desktop/renderer/components/Composer
 */

// oxlint-disable typescript/unbound-method -- zustand store actions are
// stable closures created once per store; selecting them is safe by design
// (state/store.ts), the rule cannot see that.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp, ChevronDown, Folder, Gauge, GitBranch, ListChecks, Mic, Paperclip,
  Pause, Play, Square, Target, X, Zap,
} from 'lucide-react'
import { PERMISSION_PRESETS, effortLabel, modelLabel, refreshModelsForActiveSession, useApp } from '../state/store'

/** The composer popovers (model directory / reasoning efforts). */
type Popover = 'model' | 'effort' | null

function ContextBar(): React.JSX.Element {
  const context = useApp(state => state.context)
  const workspaces = useApp(state => state.workspaces)
  const activeWorkspaceId = useApp(state => state.activeWorkspaceId)
  const workspace = workspaces.find(item => item.workspaceId === activeWorkspaceId)

  const projectName = workspace?.title ?? context?.path.split('/').filter(Boolean).at(-1) ?? '未选择项目'
  return (
    <div className="context-bar">
      <span className="context-chip">
        <Folder size={12} strokeWidth={1.5} />
        <span className="context-chip-text">{projectName}</span>
      </span>
      <span className="context-chip">
        <Zap size={12} strokeWidth={1.5} />
        <span className="context-chip-text">Local</span>
      </span>
      {context?.branch !== undefined && (
        <span className="context-chip">
          <GitBranch size={12} strokeWidth={1.5} />
          <span className="context-chip-text">{context.branch}</span>
        </span>
      )}
    </div>
  )
}

/** The model picker popover: provider groups, then the reasoning efforts of the chosen model. */
function ModelMenu({ open, onClose }: { open: Popover; onClose: () => void }): React.JSX.Element | null {
  const models = useApp(state => state.models)
  const selectModel = useApp(state => state.selectModel)
  const activeSessionId = useApp(state => state.activeSessionId)

  if (open === null || models === null || activeSessionId === null) return null

  const current = models.current
  const currentModel = models.groups
    .find(group => group.id === current.provider)
    ?.models.find(model => model.id === current.model)

  if (open === 'effort' && currentModel?.reasoning !== undefined) {
    return (
      <div className="popover" role="menu">
        <div className="popover-label">Reasoning Level</div>
        <button
          className={`popover-item${current.reasoningEffort === undefined ? ' selected' : ''}`}
          onClick={() => { void selectModel(current.provider, current.model); onClose() }}
        >
          <span>自动</span>
          <span className="popover-hint">适配器默认</span>
        </button>
        {currentModel.reasoning.efforts.map(effort => (
          <button
            key={effort.id}
            className={`popover-item${current.reasoningEffort === effort.id ? ' selected' : ''}`}
            onClick={() => { void selectModel(current.provider, current.model, effort.id); onClose() }}
          >
            <span>{effort.name}</span>
            {effort.description !== undefined && <span className="popover-hint">{effort.description}</span>}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="popover popover-wide" role="menu">
      <div className="popover-label">模型</div>
      {models.groups.map(group => (
        <div key={group.id} className="popover-group">
          <div className="popover-group-label">{group.name}</div>
          {group.models.map(model => (
            <button
              key={model.id}
              className={`popover-item${current.provider === group.id && current.model === model.id ? ' selected' : ''}`}
              onClick={() => { void selectModel(group.id, model.id); onClose() }}
            >
              <span>{model.name}</span>
            </button>
          ))}
        </div>
      ))}
      {models.groups.length === 0 && <div className="popover-empty">没有可用的模型</div>}
    </div>
  )
}

/** The permission-preset selector (the host /permission command's options). */
function PermissionMenu({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const permissionPreset = useApp(state => state.permissionPreset)
  const setPermissionPreset = useApp(state => state.setPermissionPreset)
  if (!open) return null
  return (
    <div className="popover popover-narrow" role="menu">
      <div className="popover-label">权限预设</div>
      {PERMISSION_PRESETS.map(preset => (
        <button
          key={preset.name}
          className={`popover-item${permissionPreset === preset.name ? ' selected' : ''}`}
          onClick={() => { setPermissionPreset(preset.name); onClose() }}
        >
          <span>{preset.label}</span>
          <span className="popover-hint">/{preset.name}</span>
        </button>
      ))}
    </div>
  )
}

/** The slash-command menu: host commands and user-invocable skills. */
function SlashMenu({ query, onPick }: { query: string; onPick: (text: string) => void }): React.JSX.Element | null {
  const commands = useApp(state => state.commands)
  const skills = useApp(state => state.skills)
  const activeSessionId = useApp(state => state.activeSessionId)
  if (activeSessionId === null) {
    return (
      <div className="popover popover-wide slash-menu" role="menu">
        <div className="popover-empty">开始会话后可用 / 命令与技能。</div>
      </div>
    )
  }
  const q = query.toLowerCase()
  const commandHits = commands.filter(item => item.name.includes(q) || item.description.toLowerCase().includes(q)).slice(0, 8)
  const skillHits = skills.filter(item => item.name.includes(q) || item.description.toLowerCase().includes(q)).slice(0, 8)
  if (commandHits.length === 0 && skillHits.length === 0) {
    return (
      <div className="popover popover-wide slash-menu" role="menu">
        <div className="popover-empty">没有匹配的命令或技能。</div>
      </div>
    )
  }
  return (
    <div className="popover popover-wide slash-menu" role="menu">
      {commandHits.length > 0 && (
        <>
          <div className="popover-label">命令</div>
          {commandHits.map(item => (
            <button
              key={`cmd-${item.name}`}
              className="popover-item"
              onClick={() => onPick(`/${item.name} `)}
            >
              <span>/{item.name}</span>
              <span className="popover-hint">{item.description}</span>
            </button>
          ))}
        </>
      )}
      {skillHits.length > 0 && (
        <>
          <div className="popover-label">技能</div>
          {skillHits.map(item => (
            <button
              key={`skill-${item.name}`}
              className="popover-item"
              onClick={() => onPick(`/${item.name} `)}
            >
              <span>/{item.name}</span>
              <span className="popover-hint">{item.description}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

/** The goal chip: create, pause, resume, complete. */
function GoalChip(): React.JSX.Element | null {
  const goal = useApp(state => state.goal)
  const createGoal = useApp(state => state.createGoal)
  const pauseGoal = useApp(state => state.pauseGoal)
  const resumeGoal = useApp(state => state.resumeGoal)
  const completeGoal = useApp(state => state.completeGoal)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')

  if (goal !== null) {
    return (
      <span className={`goal-chip ${goal.phase}`}>
        <Target size={12} strokeWidth={1.5} />
        <span className="goal-text">{goal.objective}</span>
        {goal.phase === 'active'
          ? <button className="goal-action" title="暂停" onClick={() => void pauseGoal()}><Pause size={11} strokeWidth={1.5} /></button>
          : <button className="goal-action" title="继续" onClick={() => void resumeGoal()}><Play size={11} strokeWidth={1.5} /></button>}
        <button className="goal-action" title="完成" onClick={() => void completeGoal()}><X size={11} strokeWidth={1.5} /></button>
      </span>
    )
  }
  if (!editing) {
    return (
      <button className="goal-chip add" onClick={() => setEditing(true)}>
        <Target size={12} strokeWidth={1.5} />
        <span>目标</span>
      </button>
    )
  }
  return (
    <span className="goal-chip editing">
      <input
        className="goal-input"
        placeholder="目标内容，Enter 创建"
        value={input}
        autoFocus
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            void createGoal(input)
            setInput('')
            setEditing(false)
          }
          if (event.key === 'Escape') { setInput(''); setEditing(false) }
        }}
      />
    </span>
  )
}

/** Pending queued input rows above the composer: edit / steer / remove. */
function QueueRows(): React.JSX.Element | null {
  // Stable-reference selector: React's useSyncExternalStore requires the
  // snapshot to keep its identity until the store really changes; a fresh
  // `[]` per read would trip the unstable-snapshot guard into an infinite
  // re-render. `undefined` is the stable "no queue" value.
  const queue = useApp(state => {
    if (state.activeSessionId === null) return undefined
    return state.conversations[state.activeSessionId]?.queue
  })
  const queueItems = queue ?? []
  const updateQueueItem = useApp(state => state.updateQueueItem)
  const setDraft = useApp(state => state.setDraft)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const visible = queueItems.filter(item => item.placement !== 'context')
  if (visible.length === 0) return null
  return (
    <div className="queue-rows">
      {visible.map(item => {
        const text = item.message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('')
        if (editing === item.id) {
          return (
            <div key={item.id} className="queue-row editing">
              <input
                className="queue-input"
                value={editText}
                autoFocus
                onChange={event => setEditText(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    void updateQueueItem(item.id, { kind: 'edit', text: editText })
                    setEditing(null)
                  }
                  if (event.key === 'Escape') setEditing(null)
                }}
              />
            </div>
          )
        }
        return (
          <div key={item.id} className="queue-row">
            <span className="queue-placement">{item.placement === 'steering' ? '置顶' : '排队'}</span>
            <span className="queue-text">{text}</span>
            <button
              className="queue-action"
              title="编辑"
              onClick={() => { setEditing(item.id); setEditText(text) }}
            >编辑</button>
            <button
              className="queue-action"
              title="置顶"
              onClick={() => void updateQueueItem(item.id, { kind: 'steer' })}
            >置顶</button>
            <button
              className="queue-action danger"
              title="删除"
              onClick={() => void updateQueueItem(item.id, { kind: 'remove' })}
            >删除</button>
            <button
              className="queue-action"
              title="回填到输入框"
              onClick={() => { setDraft(text); void updateQueueItem(item.id, { kind: 'remove' }) }}
            >编辑到输入框</button>
          </div>
        )
      })}
    </div>
  )
}

export function ComposerDock(): React.JSX.Element {
  const draft = useApp(state => state.draft)
  const setDraft = useApp(state => state.setDraft)
  const send = useApp(state => state.send)
  const stop = useApp(state => state.stop)
  const activeSessionId = useApp(state => state.activeSessionId)
  const activeConversation = useApp(state => state.activeSessionId === null ? undefined : state.conversations[state.activeSessionId])
  const running = activeConversation?.running ?? false
  const planActive = activeConversation?.planActive ?? false
  const draftImages = useApp(state => state.draftImages)
  const addImage = useApp(state => state.addImage)
  const removeImage = useApp(state => state.removeImage)
  const togglePlan = useApp(state => state.togglePlan)
  const permissionPreset = useApp(state => state.permissionPreset)

  const [popover, setPopover] = useState<Popover>(null)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const models = useApp(state => state.models)

  // Load the model directory for the active session.
  useEffect(() => {
    refreshModelsForActiveSession()
  }, [activeSessionId])

  // Auto-grow the textarea.
  useEffect(() => {
    const el = textareaRef.current
    if (el === null) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [draft])

  // Typing is always sendable: without an active session, send() starts one.
  const canSend = draft.trim() !== '' || draftImages.length > 0

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend && !running) void send()
    }
    if (event.key === 'Escape') { setPopover(null); setPermissionOpen(false); setSlashOpen(false) }
  }

  /** Read image files into base64 draft attachments. */
  const handleFiles = (files: FileList | null): void => {
    if (files === null) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const data = String(reader.result).split(',')[1] ?? ''
        addImage({ name: file.name, mediaType: file.type, data })
      }
      reader.readAsDataURL(file)
    }
  }

  const modelName = useMemo(() => modelLabel(models), [models])
  const effortName = useMemo(() => effortLabel(models), [models])
  const slashQuery = draft.startsWith('/') ? draft.slice(1).split(' ')[0] ?? '' : ''

  return (
    <div className="composer-dock">
      <ContextBar />
      <div className="dock-row">
        <GoalChip />
        {activeSessionId !== null && (
          <button className={`plan-chip${planActive ? ' on' : ''}`} title="计划模式" onClick={() => void togglePlan()}>
            <ListChecks size={12} strokeWidth={1.5} />
            <span>{planActive ? '计划中' : '计划'}</span>
          </button>
        )}
      </div>
      <QueueRows />
      <div className="composer">
        {draftImages.length > 0 && (
          <div className="draft-images">
            {draftImages.map(image => (
              <span key={image.name} className="draft-image">
                <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
                <button className="draft-image-remove" aria-label="移除图片" onClick={() => removeImage(image.name)}>
                  <X size={10} strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行；/ 打开命令菜单"
          rows={1}
          value={draft}
          onChange={(event) => {
            const isSlash = event.target.value.startsWith('/')
            setDraft(event.target.value)
            setSlashOpen(isSlash)
            if (isSlash && useApp.getState().commands.length === 0 && useApp.getState().activeSessionId !== null) {
              void useApp.getState().refreshCatalogs()
            }
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <div className="composer-row">
          <div className="composer-left">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={event => { handleFiles(event.target.files); event.target.value = '' }}
            />
            <button className="icon-btn" title="添加图片" aria-label="添加图片" onClick={() => fileRef.current?.click()}>
              <Paperclip size={16} strokeWidth={1.5} />
            </button>
            <button
              className="approval-toggle"
              title="权限预设（/permission）"
              onClick={() => setPermissionOpen(!permissionOpen)}
            >
              <Zap size={13} strokeWidth={1.5} />
              <span>权限</span>
              <span className="approval-state">{permissionPreset === 'danger-full-access' ? '完全' : permissionPreset === 'read-only' ? '只读' : '工作区'}</span>
            </button>
          </div>
          <div className="composer-right">
            <button className="composer-select" onClick={() => setPopover(popover === 'model' ? null : 'model')} title="选择模型">
              <span className="composer-select-text">{modelName}</span>
              <ChevronDown size={13} strokeWidth={1.5} />
            </button>
            <button
              className="composer-select"
              onClick={() => setPopover(popover === 'effort' ? null : 'effort')}
              title="Reasoning Level"
            >
              <Gauge size={13} strokeWidth={1.5} />
              <span className="composer-select-text">{effortName}</span>
              <ChevronDown size={13} strokeWidth={1.5} />
            </button>
            <button className="icon-btn" title="语音输入（即将支持）" aria-label="语音输入" disabled>
              <Mic size={16} strokeWidth={1.5} />
            </button>
            {running
              ? (
                <button className="send-btn stop" title="停止" aria-label="停止" onClick={stop}>
                  <Square size={13} strokeWidth={1.5} fill="currentColor" />
                </button>
              )
              : (
                <button className="send-btn" title="发送" aria-label="发送" disabled={!canSend} onClick={() => void send()}>
                  <ArrowUp size={16} strokeWidth={1.5} />
                </button>
              )}
          </div>
        </div>
      </div>
      <ModelMenu open={popover} onClose={() => setPopover(null)} />
      <PermissionMenu open={permissionOpen} onClose={() => setPermissionOpen(false)} />
      {slashOpen && slashQuery !== undefined && (
        <SlashMenu query={slashQuery} onPick={(text) => { setDraft(text); setSlashOpen(false); textareaRef.current?.focus() }} />
      )}
    </div>
  )
}
