/**
 * Modal overlays: tool-approval requests, ask-user questions, and the
 * minimal settings panel (API key + runtime facts).
 * @module desktop/renderer/components/Overlays
 */

// oxlint-disable typescript/unbound-method -- zustand store actions are
// stable closures created once per store; selecting them is safe by design
// (state/store.ts), the rule cannot see that.
import { useEffect, useState } from 'react'
import { KeyRound, ShieldAlert, X } from 'lucide-react'
import type { AskUserQuestionOption, ModelProviderGroup } from '../api/contract/types'
import { useApp } from '../state/store'

/** The settings panel: credential, Web UI connection, default agent preset, and the model catalog. */
function SettingsModal(): React.JSX.Element {
  const setSettingsOpen = useApp(state => state.setSettingsOpen)
  const api = useApp(state => state.api)
  const host = useApp(state => state.host)
  const presets = useApp(state => state.presets)
  const defaultPreset = useApp(state => state.defaultPreset)
  const setDefaultPreset = useApp(state => state.setDefaultPreset)
  const connection = useApp(state => state.connection)
  const refreshConnection = useApp(state => state.refreshConnection)
  const saveServerUrl = useApp(state => state.saveServerUrl)
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ModelProviderGroup[] | null>(null)
  const [serverUrl, setServerUrl] = useState('')

  // Connection facts + host-scoped model catalog for the settings view.
  useEffect(() => {
    void refreshConnection()
    if (api === null) return
    void api.llm.models({}).then(response => {
      if (response.result.ok) setCatalog(response.result.value.groups)
    })
  }, [api, refreshConnection])

  const save = async (): Promise<void> => {
    if (api === null || key.trim() === '') return
    const response = await api.credentials.set({ ref: 'DEEPSEEK_API_KEY', value: key.trim() })
    if (response.result.ok) {
      setKey('')
      setSaved(true)
      setTimeout(() => { setSaved(false) }, 2000)
    } else {
      setError(response.result.error.message)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => { setSettingsOpen(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') setSettingsOpen(false) }}
    >
      <div className="modal modal-wide" role="dialog" aria-label="设置" onClick={(event) => { event.stopPropagation() }}>
        <header className="modal-header">
          <h2 className="modal-title">设置</h2>
          <button className="icon-btn" aria-label="关闭" onClick={() => { setSettingsOpen(false) }}>
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>

        <section className="modal-section">
          <h3 className="modal-section-title">API 密钥</h3>
          <p className="modal-desc">
            DeepSeek 官方适配器按请求解析 <code>DEEPSEEK_API_KEY</code>。密钥由 Web UI 的 credentials seam
            保存到官方 <code>DSH_HOME</code> 管理的数据中，不会进入客户端的连接配置。
          </p>
          <div className="key-row">
            <KeyRound size={14} strokeWidth={1.5} />
            <input
              type="password"
              className="key-input"
              placeholder="sk-…"
              value={key}
              onChange={(event) => { setKey(event.target.value); setError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') void save() }}
            />
            <button className="ghost-btn" onClick={() => void save()} disabled={key.trim() === ''}>保存</button>
          </div>
          {saved && <p className="modal-note ok">已保存。</p>}
          {error !== null && <p className="modal-note error">{error}</p>}
        </section>

        <section className="modal-section">
          <h3 className="modal-section-title">Web UI 连接</h3>
          <p className="modal-desc">
            客户端只通过 dsh Web UI 的公开接口通信。留空 = 由客户端启动本地 <code>dsh web</code>；
            填写地址 = 直接连接该实例（本地或远程）。
          </p>
          <div className="key-row">
            <input
              className="key-input"
              placeholder="http://127.0.0.1:3080（留空启动本地）"
              value={serverUrl}
              onChange={(event) => { setServerUrl(event.target.value); setError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') void saveServerUrl(serverUrl) }}
              spellCheck={false}
            />
            <button className="ghost-btn" onClick={() => void saveServerUrl(serverUrl)}>应用并重连</button>
          </div>
          <p className="modal-desc muted">
            {connection === null
              ? '连接状态未知。'
              : connection.mode === 'local'
                ? `本地 dsh web（PID ${String(connection.childPid ?? '—')}）→ ${connection.targetUrl}`
                : `已连接 ${connection.targetUrl}`}
          </p>
        </section>

        <section className="modal-section">
          <h3 className="modal-section-title">默认 Agent 预设</h3>
          <p className="modal-desc">新建会话使用的 agent 组合（工具集与提示词）。</p>
          <select
            className="key-input"
            value={defaultPreset ?? ''}
            onChange={(event) => { setDefaultPreset(event.target.value === '' ? null : event.target.value) }}
          >
            <option value="">基础（无预设）</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.id}{preset.isDefault ? '（默认）' : ''}{preset.trust === 'user' ? '（本地）' : ''}
              </option>
            ))}
          </select>
        </section>

        <section className="modal-section">
          <h3 className="modal-section-title">模型目录</h3>
          {catalog === null && <p className="modal-desc">加载中…</p>}
          {catalog !== null && catalog.length === 0 && <p className="modal-desc">没有可用的模型。</p>}
          {catalog !== null && catalog.map(group => (
            <div key={group.id} className="model-group">
              <div className="model-group-name">{group.name}</div>
              {group.models.map(model => (
                <div key={model.id} className="model-row">
                  <span className="model-name">{model.name}</span>
                  {model.description !== undefined && <span className="model-desc">{model.description}</span>}
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="modal-section">
          <h3 className="modal-section-title">运行时</h3>
          <p className="modal-desc">
            dsh Web UI · 版本 {host !== null ? host.version : '—'} · 官方数据目录 DSH_HOME
          </p>
        </section>
      </div>
    </div>
  )
}

/** One approval request: allow-once or reject a tool call. */
function ApprovalModal(): React.JSX.Element {
  const approvals = useApp(state => state.approvals)
  const respondApproval = useApp(state => state.respondApproval)
  const approval = approvals[0]
  if (approval === undefined) return <></>
  return (
    <div className="modal-backdrop">
      <div className="modal modal-narrow" role="dialog" aria-label="工具审批">
        <header className="modal-header">
          <h2 className="modal-title">允许工具调用？</h2>
          <ShieldAlert size={16} strokeWidth={1.5} className="modal-title-icon" />
        </header>
        <div className="approval-body">
          <p className="approval-tool">{approval.toolName}</p>
          {approval.reason !== undefined && <p className="modal-desc">{approval.reason}</p>}
          {approval.callId !== undefined && <p className="modal-desc muted">调用 {approval.callId}</p>}
        </div>
        <footer className="modal-footer">
          <button className="ghost-btn" onClick={() => void respondApproval(0, 'rejected')}>拒绝</button>
          <button className="primary-btn" onClick={() => void respondApproval(0, 'allowed-once')}>允许一次</button>
        </footer>
      </div>
    </div>
  )
}

/** One ask-user question batch: single/multi select options plus custom text. */
function QuestionModal(): React.JSX.Element {
  const questions = useApp(state => state.questions)
  const respondQuestion = useApp(state => state.respondQuestion)
  const batch = questions[0]
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  if (batch === undefined) return <></>

  const toggle = (id: string, label: string, multi: boolean): void => {
    setSelected((prev) => {
      const current = prev[id] ?? []
      return {
        ...prev,
        [id]: multi
          ? current.includes(label) ? current.filter(item => item !== label) : [...current, label]
          : [label],
      }
    })
  }

  const submit = (): void => {
    const answers = batch.questions.map(item => ({
      id: item.id,
      selected: selected[item.id] ?? [],
      ...custom[item.id] !== undefined && custom[item.id] !== '' && { custom: custom[item.id] },
    }))
    void respondQuestion(0, answers)
    setSelected({})
    setCustom({})
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="提问">
        <header className="modal-header">
          <h2 className="modal-title">需要确认</h2>
        </header>
        <div className="question-body">
          {batch.questions.map(item => (
            <div key={item.id} className="question-item">
              {item.header !== undefined && <h3 className="modal-section-title">{item.header}</h3>}
              <p className="question-text">{item.question}</p>
              {item.detail !== undefined && <p className="modal-desc">{item.detail}</p>}
              {item.options !== undefined && item.options.length > 0 && (
                <div className="question-options">
                  {item.options.map((option: AskUserQuestionOption) => (
                    <label key={option.label} className={`question-option${(selected[item.id] ?? []).includes(option.label) ? ' selected' : ''}`}>
                      <input
                        type={item.multiSelect === true ? 'checkbox' : 'radio'}
                        name={item.id}
                        checked={(selected[item.id] ?? []).includes(option.label)}
                        onChange={() =>{  toggle(item.id, option.label, item.multiSelect === true) }}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              )}
              <input
                className="key-input question-custom"
                placeholder="其他回答…"
                value={custom[item.id] ?? ''}
                onChange={(event) =>{  setCustom(prev => ({ ...prev, [item.id]: event.target.value })) }}
              />
            </div>
          ))}
        </div>
        <footer className="modal-footer">
          <button className="ghost-btn" onClick={() => void respondQuestion(0, [])}>取消</button>
          <button className="primary-btn" onClick={submit}>提交</button>
        </footer>
      </div>
    </div>
  )
}

export function Overlays(): React.JSX.Element {
  const settingsOpen = useApp(state => state.settingsOpen)
  return (
    <>
      {settingsOpen && <SettingsModal />}
      <ApprovalModal />
      <QuestionModal />
    </>
  )
}
