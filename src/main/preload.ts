/**
 * Desktop client preload: the minimal fixed surface exposed to the official
 * Web UI page, plus the "enhanced features" seat — a connection-settings card
 * injected into the OFFICIAL settings dialog (marked 增强功能/Enhanced), kept
 * visually separate and optional: if the official dialog cannot be detected
 * the injection silently does nothing and the official UI is untouched.
 * Runs sandboxed, so only Electron APIs are available; the OS username
 * arrives from the main process via an additional argv flag.
 * @module dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  const arg = process.argv.find(item => item.startsWith(prefix))
  return arg === undefined ? undefined : arg.slice(prefix.length)
}

/** Connection facts mirrored from the main process. */
interface ConnectionStatus {
  mode: 'local' | 'probe' | 'connect'
  targetUrl: string
  desktopVersion: string
  dshVersion: string | null
  childPid?: number
  lastError?: string
}

/** The connection bridge: read/save the Web UI origin through the main process. */
const connection = {
  getStatus: (): Promise<ConnectionStatus> => ipcRenderer.invoke('desktop:connection:status') as Promise<ConnectionStatus>,
  saveServerUrl: (serverUrl: string): Promise<{ saved: boolean; error?: string }> =>
    ipcRenderer.invoke('desktop:connection:save', serverUrl) as Promise<{ saved: boolean; error?: string }>,
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  username: argValue('dsh-username') ?? 'user',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  connection,
  /** Open the client's native connection-settings window (tray-era fallback). */
  openConnectionSettings: (): void => { ipcRenderer.send('desktop:open-connection-settings') },
})

// ---------------------------------------------------------------------------
// Enhanced-features card inside the OFFICIAL settings dialog.
//
// The official UI is a black box: we never modify its DOM, only APPEND one
// clearly-marked card when its settings dialog is open. Detection is
// heuristic (ARIA dialog / modal-like container mentioning 设置); when it
// fails the card is simply absent — official behavior is never affected.
// ---------------------------------------------------------------------------

const ENHANCE_ID = 'dsh-desktop-enhance'

function visible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** Heuristic: the official settings dialog, when open. */
function findSettingsDialog(): Element | null {
  for (const el of document.querySelectorAll('[role="dialog"]')) {
    if (!visible(el)) continue
    const text = el.textContent ?? ''
    if (text.includes('设置') || text.includes('Settings')) return el
  }
  for (const el of document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="drawer" i], [class*="sheet" i]')) {
    if (!visible(el) || el.tagName === 'BUTTON' || el.tagName === 'INPUT') continue
    const text = el.textContent ?? ''
    if (text.includes('设置') && text.length < 6000) return el
  }
  return null
}

/** The settings dialog's form-flow container (the nav's content column). */
function findOptions(dialog: Element): Element | null {
  const content = [...dialog.children].find(c => String(c.className ?? '').includes('content'))
  if (content === undefined) return null
  return [...content.children].find(c => String(c.className ?? '').includes('options')) ?? null
}

/** Whether the GENERAL tab is active (the enhanced block lives only there). */
function isGeneralTab(dialog: Element): boolean {
  const navList = [...dialog.querySelectorAll('[class*="navList"]')][0]
  const active = navList?.querySelector('[class*="active"]')
  const label = active?.textContent?.trim() ?? ''
  return label === '通用设置' || label === 'General' || label === 'General Settings'
}

/**
 * The options column's currently visible panel (the general tab's panel when
 * the general tab is active). React replaces panels on tab switch, so the
 * enhanced block must hang off the panel itself — it then disappears with it.
 */
function findVisiblePanel(options: Element): Element | null {
  for (const child of options.children) {
    if (child.id === ENHANCE_ID) continue
    if (hasVisibleContent(child)) return child
  }
  return null
}

/** display:contents has no own box; visibility comes from a visible descendant. */
function hasVisibleContent(element: Element): boolean {
  const display = getComputedStyle(element).display
  if (display === 'none') return false
  if (display === 'contents') return [...element.children].some(hasVisibleContent)
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** Append the enhanced-connection block to the GENERAL form flow, matching the official rows. */
function injectEnhance(panel: Element): void {
  if (panel.querySelector('#' + ENHANCE_ID) !== null) return

  if (document.getElementById(ENHANCE_ID + '-style') === null) {
    const style = document.createElement('style')
    style.id = ENHANCE_ID + '-style'
    // Official form language: block flow under the options column (padding
    // 0 24px 24px), rows are flex columns, labels #0F1115 14px, secondary
    // text #6E7480 13px, inputs 13px/8px radius/#D8D8D4, ghost buttons 28px.
    style.textContent = [
      '#' + ENHANCE_ID + '{margin:0;padding:16px 0}',
      '#' + ENHANCE_ID + ' .dsh-enhance-title{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary,#0F1115)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-badge{font-size:12px;font-weight:400;color:var(--dsw-alias-label-primary,#0F1115);background:var(--dsw-alias-bg-module-platform,#EBEEF2);border-radius:999px;padding:2px 8px}',
      '#' + ENHANCE_ID + ' .dsh-enhance-status{margin:0 0 12px;font-size:13px;color:var(--dsw-alias-label-secondary,#6E7480)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-version{margin:0 0 12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8A9099)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-row{display:flex;gap:8px;align-items:center}',
      '#' + ENHANCE_ID + ' .dsh-enhance-input{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#D8D8D4);border-radius:8px;padding:6px 10px;font-size:13px;color:var(--dsw-alias-label-primary,#0F1115);outline:none}',
      '#' + ENHANCE_ID + ' .dsh-enhance-input:focus{border-color:var(--dsw-alias-brand-primary,#0F1115)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-input::placeholder{color:var(--dsw-alias-label-dimmed,#9AA0A6)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-save{white-space:nowrap;background:transparent;border:1px solid var(--dsw-alias-border-l2,#D8D8D4);border-radius:28px;padding:6px 16px;font-size:13px;color:var(--dsw-alias-label-primary,#0F1115);cursor:pointer;transition:background .15s ease}',
      '#' + ENHANCE_ID + ' .dsh-enhance-save:hover{background:var(--dsw-alias-interactive-bg-hover,#F5F6F7)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-note{margin:10px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#6E7480)}',
    ].join('')
    document.head.appendChild(style)
  }

  const block = document.createElement('div')
  block.id = ENHANCE_ID
  block.innerHTML =
    '<div class="dsh-enhance-title">连接<span class="dsh-enhance-badge">增强功能</span></div>'
    + '<p class="dsh-enhance-status" id="dsh-enhance-status">连接状态读取中…</p>'
    + '<p class="dsh-enhance-version" id="dsh-enhance-version"></p>'
    + '<div class="dsh-enhance-row">'
    + '<input class="dsh-enhance-input" id="dsh-enhance-url" spellcheck="false" placeholder="Web UI 地址，留空 = 智能（本机官方实例优先，否则本地启动）">'
    + '<button class="dsh-enhance-save" id="dsh-enhance-save" type="button">保存并重连</button>'
    + '</div>'
    + '<p class="dsh-enhance-note" id="dsh-enhance-note"></p>'
  const statusEl = block.querySelector('#dsh-enhance-status') as HTMLElement
  const versionEl = block.querySelector('#dsh-enhance-version') as HTMLElement
  const urlEl = block.querySelector('#dsh-enhance-url') as HTMLInputElement
  const noteEl = block.querySelector('#dsh-enhance-note') as HTMLElement
  block.querySelector('#dsh-enhance-save')?.addEventListener('click', async () => {
    const result = await connection.saveServerUrl(urlEl.value.trim())
    noteEl.textContent = result.saved ? '已保存，正在重连…' : ('保存失败：' + (result.error ?? '未知错误'))
  })
  void connection.getStatus().then((status) => {
    const modeLabel = status.mode === 'probe'
      ? '已连接本机正在运行的官方实例'
      : status.mode === 'connect' ? '固定连接' : '本地 dsh web'
    statusEl.textContent = modeLabel + ' → ' + (status.targetUrl || '（未就绪）')
      + (status.childPid !== undefined ? ' · PID ' + String(status.childPid) : '')
      + (status.lastError !== undefined ? ' · ' + status.lastError : '')
    versionEl.textContent = '桌面客户端 v' + status.desktopVersion + ' · 内置 dsh ' + (status.dshVersion ?? '不可用')
  }).catch(() => { statusEl.textContent = '连接状态不可用' })
  panel.appendChild(block)
}

// ---------------------------------------------------------------------------
// "Where do I get a key?" line under the OFFICIAL DeepSeek credential field.
//
// The official first-run modal ("添加一个 API Key 开始使用") and the Models
// provider editor both ask for a key without saying where to create one, which
// strands a user who has never visited the platform. One appended line, same
// append-only rule as the card above: DeepSeek surfaces only, silently absent
// when the heuristic misses. The anchor opens through the main process's
// window-open handler, i.e. in the system browser.
// ---------------------------------------------------------------------------

const KEY_HELP_CLASS = 'dsh-desktop-key-help'
const DEEPSEEK_KEY_URL = 'https://platform.deepseek.com/api_keys'

/**
 * The container to append the hint to: the credential field's own row, but
 * only when its nearest provider card is the official DeepSeek card, or the
 * field belongs to the dedicated first-run DeepSeek dialog. Never climb to
 * the whole Models section: that section also contains custom-provider forms.
 */
function keyHelpHost(input: HTMLInputElement): Element | null {
  const row = input.parentElement
  if (row === null) return null

  const providerCard = input.closest('li')
  if (providerCard !== null) {
    return /deepseek-official/i.test(providerCard.textContent ?? '') ? row : null
  }

  const dialog = input.closest('[role="dialog"]')
  const dialogText = dialog?.textContent ?? ''
  if (/official DeepSeek provider|DeepSeek 官方模型/i.test(dialogText)) return row
  return null
}

/** Append the platform link under every visible DeepSeek key field. */
function injectKeyHelp(): void {
  const inputs = document.querySelectorAll('input[type="password"]')
  if (inputs.length === 0) return

  if (document.getElementById(KEY_HELP_CLASS + '-style') === null) {
    const style = document.createElement('style')
    style.id = KEY_HELP_CLASS + '-style'
    // Official secondary-text language, via the official theme variables so
    // the line follows the appearance setting (light/dark/system).
    style.textContent = '.' + KEY_HELP_CLASS + '{margin:8px 0 0;font-size:13px;line-height:20px;'
      + 'color:var(--dsw-alias-label-secondary,#6E7480)}'
      + '.' + KEY_HELP_CLASS + ' a{color:var(--dsw-alias-label-primary,#0F1115);text-decoration:underline;cursor:pointer}'
    document.head.appendChild(style)
  }

  for (const element of inputs) {
    const input = element as HTMLInputElement
    if (!visible(input)) continue
    const host = keyHelpHost(input)
    if (host === null || host.querySelector('.' + KEY_HELP_CLASS) !== null) continue
    // The official copy follows the language setting; match it off the field's
    // own placeholder rather than a document-level guess.
    const english = /^Enter (your |an )?API key/i.test(input.placeholder)
    const help = document.createElement('p')
    help.className = KEY_HELP_CLASS
    const anchor = document.createElement('a')
    anchor.href = DEEPSEEK_KEY_URL
    anchor.target = '_blank'
    anchor.rel = 'noreferrer'
    anchor.textContent = english ? 'Create one on the DeepSeek platform' : '前往 DeepSeek 开放平台创建'
    help.append(english ? 'No API key yet? ' : '还没有 API Key？', anchor)
    host.appendChild(help)
  }
}

let watching = false

/** Watch for the official settings dialog and keep the card injected. */
function watchSettingsDialog(): void {
  if (watching) return
  watching = true
  const probe = (): void => {
    injectKeyHelp()
    // The block belongs to the general tab's panel only. React does not always
    // replace that panel on a tab switch, so an injection that is never
    // withdrawn leaks the card onto another tab (where it reads as a misplaced
    // official row). Withdraw it whenever its seat is no longer showing.
    const panel = generalPanel()
    const existing = document.getElementById(ENHANCE_ID)
    if (panel === null || (existing !== null && existing.parentElement !== panel)) existing?.remove()
    if (panel !== null) injectEnhance(panel)
  }

  /** The visible general-tab panel of the open settings dialog, when that is what is showing. */
  const generalPanel = (): Element | null => {
    const dialog = findSettingsDialog()
    if (dialog === null || !isGeneralTab(dialog)) return null
    const options = findOptions(dialog)
    if (options === null) return null
    return findVisiblePanel(options)
  }
  // The observer sees every mutation of a streaming chat surface, and a probe
  // measures element boxes. Running one per animation frame both collapses
  // bursts and moves the reads to a point where layout is already clean,
  // instead of forcing a synchronous relayout inside the observer callback.
  let scheduled = false
  const scheduleProbe = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      probe()
    })
  }
  new MutationObserver(scheduleProbe).observe(document.documentElement, { childList: true, subtree: true })
  probe()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchSettingsDialog, { once: true })
} else {
  watchSettingsDialog()
}
