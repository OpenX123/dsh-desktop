/**
 * The main workspace: the empty state (agent mark + welcome title) or the
 * conversation view with committed messages, live streaming, tool rows, and
 * errors.
 * @module desktop/renderer/components/Workspace
 */

// oxlint-disable typescript/unbound-method -- zustand store actions are
// stable closures created once per store; selecting them is safe by design
// (state/store.ts), the rule cannot see that.
import { useEffect, useRef, useState } from 'react'
import { Bot, GitFork, Loader2, ShieldAlert, ThumbsDown, ThumbsUp, Wrench } from 'lucide-react'
import type { SessionId } from '../api/contract/types'
import type { SessionUi } from '../state/fold'
import { useApp } from '../state/store'
import { Markdown } from './Markdown'

/** The empty state: a quiet gray agent mark and the 31px welcome title. */
function EmptyState(): React.JSX.Element {
  const newSession = useApp(state => state.newSession)
  const pickWorkspace = useApp(state => state.pickWorkspace)
  return (
    <div className="empty">
      <div className="empty-mark">
        <Bot size={34} strokeWidth={1.2} />
      </div>
      <h1 className="empty-title">今天想构建什么？</h1>
      <p className="empty-sub">开始一个新对话，或从左侧打开一个项目。</p>
      <div className="empty-actions">
        <button className="ghost-btn" onClick={() => void newSession()}>新建会话</button>
        <button className="ghost-btn" onClick={() => void pickWorkspace()}>添加项目</button>
      </div>
    </div>
  )
}

function ToolRow({ name, status }: { name: string; status: 'running' | 'ok' | 'error' }): React.JSX.Element {
  return (
    <span className={`tool-row ${status}`}>
      {status === 'running'
        ? <Loader2 size={12} strokeWidth={1.5} className="spin" />
        : <Wrench size={12} strokeWidth={1.5} />}
      <span className="tool-name">{name}</span>
      <span className="tool-status">
        {status === 'running' ? '运行中' : status === 'ok' ? '完成' : '失败'}
      </span>
    </span>
  )
}

function Reasoning({ text }: { text: string }): React.JSX.Element {
  return (
    <details className="reasoning">
      <summary>思考过程</summary>
      <div className="reasoning-body">{text}</div>
    </details>
  )
}

/** Message actions for committed assistant messages: fork and feedback. */
function MessageActions({ sessionId, messageId }: { sessionId: SessionId; messageId: string }): React.JSX.Element {
  const forkSession = useApp(state => state.forkSession)
  const setFeedback = useApp(state => state.setFeedback)
  const [feedback, setFeedbackState] = useState<'positive' | 'negative' | null>(null)
  return (
    <div className="message-actions">
      <button
        className="message-action"
        title="从此消息分叉新会话"
        onClick={() => void forkSession(sessionId)}
      >
        <GitFork size={12} strokeWidth={1.5} />
      </button>
      <button
        className={`message-action${feedback === 'positive' ? ' active' : ''}`}
        title="反馈：有帮助"
        onClick={() => { const next = feedback === 'positive' ? null : 'positive'; setFeedbackState(next); if (next !== null) void setFeedback(messageId, next) }}
      >
        <ThumbsUp size={12} strokeWidth={1.5} />
      </button>
      <button
        className={`message-action${feedback === 'negative' ? ' active' : ''}`}
        title="反馈：没帮助"
        onClick={() => { const next = feedback === 'negative' ? null : 'negative'; setFeedbackState(next); if (next !== null) void setFeedback(messageId, next) }}
      >
        <ThumbsDown size={12} strokeWidth={1.5} />
      </button>
    </div>
  )
}

function AssistantMessage({ message, sessionId }: { message: SessionUi['messages'][number] & { streaming?: boolean }; sessionId: SessionId }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <div className="msg assistant" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {message.reasoning !== undefined && message.reasoning !== '' && <Reasoning text={message.reasoning} />}
      {message.text !== '' && <Markdown text={message.text} />}
      {message.text === '' && message.streaming === true && (
        <span className="caret" />
      )}
      {message.tools.length > 0 && (
        <div className="tool-rows">
          {message.tools.map(tool => <ToolRow key={tool.callId} name={tool.name} status={tool.status} />)}
        </div>
      )}
      {message.streaming === true && message.text !== '' && <span className="caret" />}
      {!message.streaming && hovered && <MessageActions sessionId={sessionId} messageId={message.id} />}
    </div>
  )
}

function Conversation({ session }: { session: SessionUi }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)

  // Follow the stream: keep the tail visible while running. The session
  // object identity changes on every fold, which IS the stream.
  useEffect(() => {
    if (session.running || session.streaming !== null) {
      tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [session])

  const hasMessages = session.messages.length > 0 || session.streaming !== null

  if (!hasMessages) {
    return (
      <div className="conversation-empty">
        <p>这个会话还没有消息。</p>
        <button className="ghost-btn" onClick={() => { useApp.setState({ activeSessionId: null }) }}>关闭会话</button>
      </div>
    )
  }

  return (
    <div className="conversation-scroll" ref={scrollRef}>
      <div className="conversation-column">
        <header className="conversation-header">
          <span className="conversation-title">{session.title}</span>
          {session.planActive && <span className="running-chip"><span className="status-dot running" />计划模式</span>}
          {session.running && <span className="running-chip"><span className="status-dot running" />运行中</span>}
        </header>
        {session.tasks.length > 0 && (
          <div className="task-rows">
            {session.tasks.map(task => (
              <span key={task.id} className={`task-chip ${task.status}`}>
                <span className={`task-dot ${task.status}`} />
                <span className="task-label">{task.label}</span>
                <span className="task-status">{task.status}</span>
              </span>
            ))}
          </div>
        )}
        {session.messages.map(message => (
          message.role === 'user'
            ? (
              <div key={message.id} className="msg user">
                <div className="user-bubble">{message.text}</div>
              </div>
            )
            : <AssistantMessage key={message.id} message={message} sessionId={session.sessionId} />
        ))}
        {session.streaming !== null && (
          <AssistantMessage
            sessionId={session.sessionId}
            message={{
              id: `stream-${session.streaming.turn}-${session.streaming.step}`,
              role: 'assistant',
              text: session.streaming.text,
              reasoning: session.streaming.reasoning,
              tools: session.streaming.tools,
              time: Date.now(),
              streaming: true,
            }}
          />
        )}
        {session.error !== null && (
          <div className="error-line">
            <ShieldAlert size={14} strokeWidth={1.5} />
            <span>{session.error}</span>
          </div>
        )}
        {!session.running && session.streaming === null && session.messages.length > 0 && (
          <div className="tail-spacer" />
        )}
        <div ref={tailRef} />
      </div>
    </div>
  )
}

export function Workspace(): React.JSX.Element {
  const activeSessionId = useApp(state => state.activeSessionId)
  const conversations = useApp(state => state.conversations)
  const session = activeSessionId !== null ? conversations[activeSessionId] : undefined

  if (activeSessionId === null) return <EmptyState />
  if (session === undefined) {
    return (
      <div className="conversation-scroll">
        <div className="conversation-column">
          <div className="error-line"><ShieldAlert size={14} strokeWidth={1.5} /><span>正在加载会话…</span></div>
        </div>
      </div>
    )
  }
  return <Conversation session={session} />
}