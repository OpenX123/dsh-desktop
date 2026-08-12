/**
 * Application shell: boot the wire client, then lay out the fixed sidebar and
 * the main workspace with the floating composer.
 * @module desktop/renderer/app
 */

// oxlint-disable typescript/unbound-method -- zustand store actions are
// stable closures created once per store; selecting them is safe by design
// (state/store.ts), the rule cannot see that.
import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { ComposerDock } from './components/Composer'
import { Overlays } from './components/Overlays'
import { useApp } from './state/store'

/** Full-window boot surface while the harness carrier connects. */
function BootScreen(): React.JSX.Element {
  return (
    <div className="boot-screen">
      <div className="boot-mark">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#242424" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v1.5H7.5A2.5 2.5 0 0 0 5 9v1.5H3.5a3 3 0 0 0-3 3" />
          <path d="M12 22a3 3 0 0 0 3-3v-1.5h1.5A2.5 2.5 0 0 0 19 15v-1.5h1.5a3 3 0 0 0 3-3" />
          <circle cx="9" cy="13" r="1" fill="#242424" stroke="none" />
          <circle cx="13" cy="13" r="1" fill="#242424" stroke="none" />
          <path d="M8 17c1.2 1 2.6 1.5 4 1.5s2.8-.5 4-1.5" />
        </svg>
      </div>
      <p className="boot-text">正在连接 Web UI…</p>
    </div>
  )
}

/** Fatal boot surface: the Web UI never came up. */
function ErrorScreen({ error }: { error: string | null }): React.JSX.Element {
  const boot = useApp(state => state.boot)
  const saveServerUrl = useApp(state => state.saveServerUrl)
  const [serverUrl, setServerUrl] = useState('')
  return (
    <div className="boot-screen">
      <div className="boot-mark boot-mark-error">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B3544A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4" />
          <path d="M12 15.5h.01" />
        </svg>
      </div>
      <p className="boot-text boot-text-error">{error ?? '启动失败'}</p>
      <div className="boot-retry-row">
        <input
          className="key-input boot-url"
          placeholder="Web UI 地址（留空 = 本地启动 dsh）"
          value={serverUrl}
          onChange={(event) => { setServerUrl(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') void saveServerUrl(serverUrl) }}
          spellCheck={false}
        />
        <button className="ghost-btn" onClick={() => { void saveServerUrl(serverUrl) }}>应用并重连</button>
        <button className="ghost-btn" onClick={() => { boot() }}>重试</button>
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const phase = useApp(state => state.phase)
  const error = useApp(state => state.error)
  const boot = useApp(state => state.boot)

  useEffect(() => { boot() }, [boot])

  if (phase === 'connecting') return <BootScreen />
  if (phase === 'error') return <ErrorScreen error={error} />

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Workspace />
        <ComposerDock />
      </main>
      <Overlays />
    </div>
  )
}
