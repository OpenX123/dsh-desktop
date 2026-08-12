/**
 * The fixed left sidebar: product identity, search, primary navigation,
 * pinned projects, the projects file tree, conversation history, and the
 * fixed user area.
 * @module desktop/renderer/components/Sidebar
 */


import { useEffect, useMemo, useState } from 'react'
import {
  Bell, ChevronDown, ChevronRight, Clock, Folder, FolderPlus, ListTodo,
  MessageSquare, Plus, Search, Settings, Sparkles, Star, Trash2,
} from 'lucide-react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskView } from '../state/fold'
import { useApp } from '../state/store'

/** Relative time for history rows. */
function relativeTime(updatedAt: number): string {
  const diff = Date.now() - updatedAt
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/** One history or tree row label with a quiet title fallback. */
function sessionTitle(sessionId: SessionId, fallback: string): string {
  return fallback.trim() === '' ? '新会话' : fallback
}

export function Sidebar(): React.JSX.Element {
  const workspaces = useApp(state => state.workspaces)
  const sessions = useApp(state => state.sessions)
  const conversations = useApp(state => state.conversations)
  const activeSessionId = useApp(state => state.activeSessionId)
  const activeWorkspaceId = useApp(state => state.activeWorkspaceId)
  const pinned = useApp(state => state.pinned)
  const phase = useApp(state => state.phase)
  const searchResults = useApp(state => state.searchResults)
  const openSession = useApp(state => state.openSession)
  const newSession = useApp(state => state.newSession)
  const deleteSession = useApp(state => state.deleteSession)
  const togglePin = useApp(state => state.togglePin)
  const pickWorkspace = useApp(state => state.pickWorkspace)
  const setSettingsOpen = useApp(state => state.setSettingsOpen)

  const [query, setQuery] = useState('')
  const [view, setView] = useState<'chats' | 'tasks'>('chats')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Debounced content search: any non-empty query searches the full session
  // corpus through session.search, not just loaded titles.
  useEffect(() => {
    const timer = setTimeout(() => { void useApp.getState().search(query) }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const history = useMemo(() => {
    const workspaceSessionIds = new Set(workspaces.flatMap(item => item.sessionIds))
    const items = sessions
      .filter(item => !workspaceSessionIds.has(item.sessionId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
    if (query.trim() === '') return items
    const q = query.trim().toLowerCase()
    return items.filter(item => (conversations[item.sessionId]?.title ?? '').toLowerCase().includes(q))
  }, [sessions, workspaces, conversations, query])

  const pinnedWorkspaces = pinned
    .map(id => workspaces.find(item => item.workspaceId === id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)

  const user = (globalThis as unknown as { desktop?: { username?: string } }).desktop?.username ?? 'user'

  /** All live tasks across sessions, newest first (for the tasks view). */
  const allTasks = useMemo(() => {
    const rows: { sessionId: SessionId; sessionTitle: string; task: TaskView }[] = []
    for (const session of sessions) {
      const conv = conversations[session.sessionId]
      if (conv === undefined) continue
      for (const task of conv.tasks) rows.push({ sessionId: session.sessionId, sessionTitle: conv.title, task })
    }
    return rows.sort((a, b) => a.task.label.localeCompare(b.task.label))
  }, [sessions, conversations])

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand">
          <Sparkles size={17} strokeWidth={1.5} />
          <span className="brand-name">Harness</span>
        </div>
      </header>

      <div className="sidebar-tools">
        <div className="search-box">
          <Search size={15} strokeWidth={1.5} />
          <input
            className="search-input"
            placeholder="搜索"
            value={query}
            onChange={(event) =>{  setQuery(event.target.value) }}
            spellCheck={false}
          />
        </div>
        <button className="icon-btn" title="通知" aria-label="通知">
          <Bell size={16} strokeWidth={1.5} />
        </button>
      </div>

      <nav className="sidebar-nav">
        <button className={`nav-item${view === 'chats' ? ' active' : ''}`} onClick={() => { setView('chats'); useApp.setState({ activeSessionId: null }) }}>
          <MessageSquare size={16} strokeWidth={1.5} />
          <span>会话</span>
        </button>
        <button className={`nav-item${view === 'tasks' ? ' active' : ''}`} onClick={() => setView('tasks')}>
          <ListTodo size={16} strokeWidth={1.5} />
          <span>任务</span>
        </button>
        <button className="nav-item" onClick={() => { setSettingsOpen(true) }}>
          <Settings size={16} strokeWidth={1.5} />
          <span>设置</span>
        </button>
      </nav>

      <div className="sidebar-scroll">
        {view === 'tasks' ? (
          <section className="sidebar-section">
            <label className="section-label">后台任务</label>
            {allTasks.length === 0 && <p className="section-empty">没有正在运行的任务。</p>}
            {allTasks.map(row => (
              <button
                key={`${row.sessionId}-${row.task.id}`}
                className={`tree-row${activeSessionId === row.sessionId ? ' active' : ''}`}
                onClick={() => { setView('chats'); void openSession(row.sessionId) }}
              >
                <span className={`task-dot ${row.task.status}`} />
                <span className="tree-name">{row.task.label}</span>
                <span className="history-time">{row.task.status}</span>
              </button>
            ))}
          </section>
        ) : (
          <>
        {query.trim() !== '' && searchResults !== null && (
          <section className="sidebar-section">
            <label className="section-label">搜索结果</label>
            {searchResults.length === 0 && <p className="section-empty">没有匹配的会话。</p>}
            {searchResults.map(item => (
              <button
                key={item.sessionId}
                className={`tree-row${activeSessionId === item.sessionId ? ' active' : ''}`}
                onClick={() => void openSession(item.sessionId)}
              >
                <Search size={13} strokeWidth={1.5} className="tree-icon leaf" />
                <span className="tree-name">{conversations[item.sessionId]?.title ?? item.sessionId}</span>
              </button>
            ))}
            {searchResults.map(item => (
              <p key={`${item.sessionId}-snippet`} className="search-snippet">{item.snippet}</p>
            ))}
          </section>
        )}
        {pinnedWorkspaces.length > 0 && (
          <section className="sidebar-section">
            <label className="section-label">Pinned projects</label>
            {pinnedWorkspaces.map(workspace => (
              <button
                key={workspace.workspaceId}
                className={`tree-row${activeWorkspaceId === workspace.workspaceId ? ' active' : ''}`}
                onClick={() =>{  useApp.setState({ activeWorkspaceId: workspace.workspaceId }) }}
              >
                <Star size={14} strokeWidth={1.5} className="tree-icon star" />
                <span className="tree-name">{workspace.title}</span>
              </button>
            ))}
          </section>
        )}

        <section className="sidebar-section">
          <label className="section-label">Projects</label>
          {workspaces.length === 0 && (
            <p className="section-empty">还没有项目。添加一个文件夹开始。</p>
          )}
          {workspaces.map((workspace) => {
            const isCollapsed = collapsed[workspace.workspaceId] ?? false
            const childSessions = workspace.sessionIds
              .map(id => sessions.find(item => item.sessionId === id))
              .filter((item): item is NonNullable<typeof item> => item !== undefined)
            return (
              <div key={workspace.workspaceId} className="tree-node">
                <div className={`tree-row${activeWorkspaceId === workspace.workspaceId ? ' active' : ''}`}>
                  <button
                    className="tree-chevron"
                    aria-label={isCollapsed ? '展开' : '折叠'}
                    onClick={() =>{  setCollapsed(prev => ({ ...prev, [workspace.workspaceId]: !isCollapsed })) }}
                  >
                    {childSessions.length === 0 ? null : isCollapsed
                      ? <ChevronRight size={13} strokeWidth={1.5} />
                      : <ChevronDown size={13} strokeWidth={1.5} />}
                  </button>
                  <button
                    className="tree-main"
                    onClick={() =>{  useApp.setState({ activeWorkspaceId: workspace.workspaceId }) }}
                  >
                    <Folder size={15} strokeWidth={1.5} className="tree-icon" />
                    <span className="tree-name">{workspace.title}</span>
                  </button>
                  <button
                    className="tree-action"
                    title="固定项目"
                    aria-label="固定项目"
                    onClick={() =>{  togglePin(workspace.workspaceId) }}
                  >
                    <Star size={13} strokeWidth={1.5} className={pinned.includes(workspace.workspaceId) ? 'star-filled' : ''} />
                  </button>
                  <button
                    className="tree-action"
                    title="新建会话"
                    aria-label="新建会话"
                    onClick={() => void newSession(workspace.workspaceId)}
                  >
                    <Plus size={14} strokeWidth={1.5} />
                  </button>
                </div>
                {!isCollapsed && childSessions.length > 0 && (
                  <div className="tree-children">
                    {childSessions.map(session => (
                      <button
                        key={session.sessionId}
                        className={`tree-row child${activeSessionId === session.sessionId ? ' active' : ''}`}
                        onClick={() => void openSession(session.sessionId)}
                      >
                        <MessageSquare size={13} strokeWidth={1.5} className="tree-icon leaf" />
                        <span className="tree-name">{sessionTitle(session.sessionId, conversations[session.sessionId]?.title ?? '')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <button className="tree-row add" onClick={() => void pickWorkspace()}>
            <FolderPlus size={15} strokeWidth={1.5} className="tree-icon" />
            <span className="tree-name">添加项目</span>
          </button>
        </section>
        </>
        )}
        {view === 'chats' && (
        <section className="sidebar-section">
          <label className="section-label">Conversation history</label>
          {history.length === 0 && (
            <p className="section-empty">{query.trim() === '' ? '还没有会话。' : '没有匹配的会话。'}</p>
          )}
          {history.map(session => (
            <div key={session.sessionId} className="history-row-wrap">
              <button
                className={`history-row${activeSessionId === session.sessionId ? ' active' : ''}`}
                onClick={() => void openSession(session.sessionId)}
              >
                <Clock size={13} strokeWidth={1.5} className="tree-icon leaf" />
                <span className="tree-name">{sessionTitle(session.sessionId, conversations[session.sessionId]?.title ?? '')}</span>
                <span className="history-time">{relativeTime(session.updatedAt)}</span>
              </button>
              <button
                className="history-delete"
                title="归档会话"
                aria-label="归档会话"
                onClick={() => void deleteSession(session.sessionId)}
              >
                <Trash2 size={13} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </section>
        )}
      </div>

      <footer className="sidebar-footer">
        <div className="user-avatar">{user.slice(0, 1).toUpperCase()}</div>
        <div className="user-meta">
          <span className="user-name">{user}</span>
          <span className={`user-status ${phase}`}>
            <span className="status-dot" />
            {phase === 'ready' ? '本地运行时已连接' : '连接中'}
          </span>
        </div>
        <button className="icon-btn" title="设置" aria-label="设置" onClick={() =>{  setSettingsOpen(true) }}>
          <Settings size={15} strokeWidth={1.5} />
        </button>
      </footer>
    </aside>
  )
}
