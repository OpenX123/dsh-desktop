/**
 * Desktop client preload: the minimal fixed surface exposed to the official
 * Web UI page, plus the "enhanced features" seat — a connection-settings card
 * injected into the OFFICIAL settings dialog (marked 增强功能/Enhanced), kept
 * visually separate and optional: if the official dialog cannot be detected
 * the injection silently does nothing and the official UI is untouched.
 * Runs sandboxed, so only Electron APIs are available.
 *
 * The bridge below is exposed on every document the window loads, which in
 * Connect mode is an address the user typed. It therefore carries no local
 * facts of its own (the OS username used to ride here on an argv flag and was
 * removed — nothing consumed it), and every channel it calls is authorized
 * against the sender's origin in the main process.
 * @module dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { providerLogo } from './provider-logos.ts'
import { releaseNotesCss, renderReleaseNotes } from './release-notes.ts'

/** Connection facts mirrored from the main process. */
interface ConnectionStatus {
  mode: 'local' | 'probe' | 'connect'
  targetUrl: string
  desktopVersion: string
  dshVersion: string | null
  savedServerUrl: string
  selectedMode: 'smart' | 'connect'
  canSwitch: boolean
  childPid?: number
  lastError?: string
  /** Which dsh the local child runs. Absent for a remote caller. */
  runtimeSource?: 'override' | 'installed' | 'npx' | 'bundled' | 'checkout' | 'path'
  installedDshVersion?: string
  /** The selected npx cache lags the bundled runtime (note, not veto). */
  npxCacheOutdated?: boolean
}

/** The connection bridge: read/save the Web UI origin through the main process. */
const connection = {
  getStatus: (): Promise<ConnectionStatus> => ipcRenderer.invoke('desktop:connection:status') as Promise<ConnectionStatus>,
  saveServerUrl: (serverUrl: string): Promise<{ saved: boolean; mode?: 'smart' | 'connect'; error?: string }> =>
    ipcRenderer.invoke('desktop:connection:save', serverUrl) as Promise<{
      saved: boolean
      mode?: 'smart' | 'connect'
      error?: string
    }>,
  switchMode: (): Promise<{ switched: boolean; mode?: 'smart' | 'connect'; error?: string }> =>
    ipcRenderer.invoke('desktop:connection:switch') as Promise<{ switched: boolean; mode?: 'smart' | 'connect'; error?: string }>,
  /** An official Web UI answering on the default port right now, if any. */
  probeLocal: (): Promise<{ url: string | null }> =>
    ipcRenderer.invoke('desktop:connection:probe') as Promise<{ url: string | null }>,
}

interface UpdateInfo {
  currentVersion: string
  availableVersion: string
  notes?: string
  pubDate?: string
}

interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'restartRequired' | 'upToDate' | 'error'
  currentVersion: string
  info: UpdateInfo | null
  progress: { total: number; downloaded: number; percent: number } | null
  error: string | null
  dismissed: boolean
  isChecking: boolean
}

type CheckUpdateResult = { hasUpdate: false } | { hasUpdate: true; info: UpdateInfo }

const update = {
  getStatus: (): Promise<UpdateState> => ipcRenderer.invoke('desktop:update:status') as Promise<UpdateState>,
  check: (): Promise<CheckUpdateResult> => ipcRenderer.invoke('desktop:update:check') as Promise<CheckUpdateResult>,
  install: (): Promise<{ started: boolean; error?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('desktop:update:install') as Promise<{ started: boolean; error?: string; cancelled?: boolean }>,
  dismiss: (): Promise<void> => ipcRenderer.invoke('desktop:update:dismiss') as Promise<void>,
}

/**
 * Seats the client's OWN local documents use (the loading surface and the
 * connection-failure surface). The main process accepts them only from those
 * data: documents in the main window, so a remote page holding this same
 * bridge cannot repoint the connection or end the application with them.
 */
const local = {
  retry: (): void => { ipcRenderer.send('desktop:local:retry') },
  quit: (): void => { ipcRenderer.send('desktop:local:quit') },
  /** Leave a pinned address for Smart mode, from the failure surface. */
  useSmart: (): void => { ipcRenderer.send('desktop:local:use-smart') },
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  connection,
  update,
  local,
  /** Open the client's native connection-settings window (tray-era fallback). */
  openConnectionSettings: (): void => { ipcRenderer.send('desktop:open-connection-settings') },
})

/**
 * The official UI owns appearance (light / dark / system). Window chrome
 * still has to match whatever the page is actually painting, including the
 * in-app 深色 control that does not touch nativeTheme.
 */
function parseCssColor(color: string): { r: number; g: number; b: number; a: number } | undefined {
  const value = color.trim()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex.charAt(0) + hex.charAt(0), 16)
      const g = Number.parseInt(hex.charAt(1) + hex.charAt(1), 16)
      const b = Number.parseInt(hex.charAt(2) + hex.charAt(2), 16)
      const a = hex.length === 4 ? Number.parseInt(hex.charAt(3) + hex.charAt(3), 16) / 255 : 1
      return { r, g, b, a }
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
      }
    }
    return undefined
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)(?:\s*[,/]\s*|\s+)([\d.]+)(?:\s*[,/]\s*|\s+)([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
  if (rgb === null) return undefined
  const red = rgb[1]
  const green = rgb[2]
  const blue = rgb[3]
  if (red === undefined || green === undefined || blue === undefined) return undefined
  const alpha = rgb[4]
  return {
    r: Number(red),
    g: Number(green),
    b: Number(blue),
    a: alpha === undefined ? 1 : alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha),
  }
}

function colorIsDark(color: string): boolean | undefined {
  const parsed = parseCssColor(color)
  if (parsed === undefined || Number.isNaN(parsed.r + parsed.g + parsed.b) || parsed.a < 0.5) return undefined
  return (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) < 128
}

const THEME_TOKEN_NAMES = ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-0', '--dsw-alias-bg-app']

function themeFrom(el: Element | null): boolean | undefined {
  if (el === null) return undefined
  const style = getComputedStyle(el)
  for (const name of THEME_TOKEN_NAMES) {
    const token = style.getPropertyValue(name).trim()
    const fromToken = token === '' ? undefined : colorIsDark(token)
    if (fromToken !== undefined) return fromToken
  }
  return colorIsDark(style.backgroundColor)
}

/** Whether pageLooksDark's latest answer came from real page paint. */
let pageLookKnown = false

function pageLooksDark(): boolean {
  const root = document.documentElement
  const scheme = getComputedStyle(root).colorScheme
  const hasDark = /\bdark\b/.test(scheme)
  const hasLight = /\blight\b/.test(scheme)
  let look: boolean | undefined
  if (hasDark && !hasLight) look = true
  else if (hasLight && !hasDark) look = false
  if (look === undefined) look = themeFrom(root)
  const body = document.body
  if (look === undefined) look = themeFrom(body)
  if (look === undefined) look = themeFrom(body?.firstElementChild ?? null)
  pageLookKnown = look !== undefined
  return look ?? matchMedia('(prefers-color-scheme: dark)').matches
}

type AppearanceMode = 'system' | 'fixed'

const APPEARANCE_MODE_KEY = 'dsh-desktop-appearance-mode'

function readRememberedAppearanceMode(): AppearanceMode | undefined {
  try {
    const stored = sessionStorage.getItem(APPEARANCE_MODE_KEY)
    return stored === 'system' || stored === 'fixed' ? stored : undefined
  } catch {
    return undefined
  }
}

function writeRememberedAppearanceMode(mode: AppearanceMode): void {
  rememberedAppearanceMode = mode
  try { sessionStorage.setItem(APPEARANCE_MODE_KEY, mode) } catch { /* data: origins / quota */ }
}

let rememberedAppearanceMode: AppearanceMode | undefined = readRememberedAppearanceMode()

function appearanceButtonMode(el: Element): AppearanceMode | undefined {
  const labelled = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, '')
  if (/^(浅色|深色|Light|Dark)$/i.test(labelled)) return 'fixed'
  if (/^(系统|跟随系统|System|Auto|Automatic)$/i.test(labelled)) return 'system'
  return undefined
}

function isAppearancePressed(el: Element): boolean {
  const state = el.getAttribute('data-state')
  return el.getAttribute('aria-pressed') === 'true'
    || el.getAttribute('aria-checked') === 'true'
    || el.getAttribute('aria-selected') === 'true'
    || state === 'on' || state === 'checked' || state === 'active'
}

function appearanceModeFromDialog(): AppearanceMode | undefined {
  const dialog = findSettingsDialog()
  if (dialog === null) return undefined
  let sawFixed = false
  let sawSystem = false
  for (const el of dialog.querySelectorAll('button, [role="button"], [role="radio"]')) {
    const mode = appearanceButtonMode(el)
    if (mode === undefined || !isAppearancePressed(el)) continue
    if (mode === 'system') sawSystem = true
    else sawFixed = true
  }
  if (sawSystem) return 'system'
  if (sawFixed) return 'fixed'
  return undefined
}

/**
 * Prefer the official appearance control over painted color. Color vs
 * matchMedia is only a bootstrap guess, and it is wrong once themeSource is
 * pinned (matchMedia then reports the pin, not the OS): re-reading it after
 * the pin flips the guess to the opposite answer, and the main process
 * pinning/unpinning in response is the fixed ↔ system loop that keeps
 * repainting the Windows window chrome. The guess is therefore taken at most
 * once per document and remembered; an explicit in-app appearance click or
 * an open settings dialog overrides it and re-syncs the memory.
 */
function currentAppearanceMode(dark: boolean): AppearanceMode {
  const fromDialog = appearanceModeFromDialog()
  if (fromDialog !== undefined) {
    writeRememberedAppearanceMode(fromDialog)
    return fromDialog
  }
  if (rememberedAppearanceMode !== undefined) return rememberedAppearanceMode
  // No real paint signal yet: pageLooksDark fell back to matchMedia, so the
  // comparison below is trivially equal and would latch a guess with no
  // information in it (a fixed dark choice the page applies after load would
  // be locked to "system"). Report "system" — it never pins themeSource, so
  // matchMedia keeps reading the real OS and the guess can still be taken
  // correctly once the page actually paints.
  if (!pageLookKnown) return 'system'
  const guessed = dark === matchMedia('(prefers-color-scheme: dark)').matches ? 'system' : 'fixed'
  writeRememberedAppearanceMode(guessed)
  return guessed
}

function watchPageTheme(): void {
  let lastDark: boolean | undefined
  let lastMode: AppearanceMode | undefined
  const report = (): void => {
    const dark = pageLooksDark()
    const mode = currentAppearanceMode(dark)
    if (dark === lastDark && mode === lastMode) return
    lastDark = dark
    lastMode = mode
    ipcRenderer.send('desktop:theme', { dark, mode })
  }
  const onAppearanceGesture = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button, [role="button"], [role="radio"]')
    if (button === null) return
    const mode = appearanceButtonMode(button)
    if (mode === undefined) return
    writeRememberedAppearanceMode(mode)
    report()
  }
  document.addEventListener('click', onAppearanceGesture, true)
  document.addEventListener('change', onAppearanceGesture, true)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report)
  ipcRenderer.on('desktop:theme:refresh', report)
  const observerOptions: MutationObserverInit = {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-appearance', 'aria-pressed', 'aria-checked', 'aria-selected', 'data-state'],
  }
  new MutationObserver(report).observe(document.documentElement, observerOptions)
  if (document.body !== null) new MutationObserver(report).observe(document.body, observerOptions)
  setInterval(report, 2000)
  report()
}

// ---------------------------------------------------------------------------
// Small desktop affordances around the OFFICIAL web UI. The official UI is a
// black box, so every adapter is optional, DOM-only and safe to skip when its
// expected seat is absent.
// ---------------------------------------------------------------------------

const ENHANCE_ID = 'dsh-desktop-enhance'
const UPDATE_ID = 'dsh-desktop-update'
const MORE_SETTINGS_ID = 'dsh-desktop-more-settings'
const PET_SETTING_ID = 'dsh-desktop-pet-setting'
const PET_VISIBILITY_STYLE_ID = 'dsh-desktop-pet-visibility'
const PET_VISIBILITY_KEY = 'dsh-desktop:harness-pet-visible'
const INTERFACE_POLISH_ID = 'dsh-desktop-interface-polish'
const FOLDED_SETTINGS = new Set(['自定义提示词', '第三方模型思考强度', 'WSL 后端', '识图插件（view_image）'])
const SETTINGS_NAV_ICON_PATHS: Record<string, string> = {
  归档管理: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  插件市场: '<path d="m2 7 2-4h16l2 4M5 13v8M19 13v8M4 21h16"/><path d="M2 7a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 2 0"/><path d="M8 21v-5h8v5"/>',
  更多: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  小鲸鱼: '<path d="M3 13c1.5-3.7 4.4-5.5 8.3-5.5 3 0 5.3 1 6.8 3 .7 1 1 2 .8 3-1.2 2.7-4.1 3.8-7.9 3.8-3.5 0-6.1-1.1-6.8-3.4-.2-.9.1-1.9.8-2.6"/><path d="M18 10c1.6-.2 2.5-1.2 2.7-3 1.2.5 2 1.4 2.1 2.7"/><circle cx="13" cy="11" r=".9" fill="currentColor" stroke="none"/>',
  自定义提示词: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 8h8M8 12h5"/>',
  第三方模型思考强度: '<path d="M9.5 4A3.5 3.5 0 0 0 6 7.5c0 .4.1.8.2 1.1A3.5 3.5 0 0 0 7.5 15H9v4a2 2 0 0 0 4 0V5.5A3.5 3.5 0 0 0 9.5 2 3.4 3.4 0 0 0 7 3"/><path d="M14.5 4A3.5 3.5 0 0 1 18 7.5c0 .4-.1.8-.2 1.1A3.5 3.5 0 0 1 16.5 15H15M9 10H7M15 8h2M9 15H7"/>',
  'WSL 后端': '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  '识图插件（view_image）': '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  侧边卡片: '<rect width="20" height="18" x="2" y="3" rx="2"/><path d="M15 3v18M18 8h-1M18 12h-1"/>',
}
const CHINESE_PROVIDER_PREFIXES = ['ant-ling', 'deepseek', 'kimi', 'minimax', 'moonshotai', 'qwen', 'xiaomi', 'zai']
const PROVIDER_NAMES: Record<string, string> = {
  'ant-ling': 'Ant Ling',
  deepseek: 'DeepSeek',
  'kimi-coding': 'Kimi Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI CN',
  'qwen-token-plan': 'Qwen Token Plan',
  'qwen-token-plan-cn': 'Qwen Token Plan CN',
  xiaomi: 'Xiaomi MiMo',
  'xiaomi-token-plan-ams': 'Xiaomi Plan AMS',
  'xiaomi-token-plan-cn': 'Xiaomi Plan CN',
  'xiaomi-token-plan-sgp': 'Xiaomi Plan SGP',
  zai: 'Z.AI',
  'zai-coding-cn': 'Z.AI Coding CN',
}
const RELEASES_PAGE_URL = 'https://github.com/bruc3van/dsh-desktop/releases'

/**
 * The "open the releases page" glyph, beside 检查更新. An in-app download can
 * fail on a machine that reaches GitHub only through a proxy this process does
 * not use, and the manual page is then the way out. Inline SVG so it follows
 * the official theme's text colour; the anchor leaves through the main
 * process's window-open handler, i.e. in the system browser.
 */
const EXTERNAL_LINK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
  + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>'
  + '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path></svg>'

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

/** Soften the optional workbench's shared tab strips and workspace explorer. */
function injectInterfacePolish(): void {
  if (document.getElementById(INTERFACE_POLISH_ID) !== null) return
  const style = document.createElement('style')
  style.id = INTERFACE_POLISH_ID
  style.textContent = [
    '[role="presentation"]:has(>[role="dialog"]),[role="presentation"]:has(>[role="dialog"])>[class*="_mask"]'
      + '{background:transparent!important;backdrop-filter:none!important}',
    '[class*="_pane"]>[class*="_tabBar"]{box-sizing:border-box;height:40px!important;padding:4px 6px!important;'
      + 'align-items:center!important;background:transparent!important;border-bottom-color:var(--dsw-alias-border-l1)!important}',
    '[class*="_pane"]>[class*="_tabBar"] [class*="_tabList"]{align-items:center;gap:4px}',
    '[class*="_tabList"]>div[draggable="true"]{height:28px;border-right:0!important;border-radius:8px;'
      + 'padding:0 6px 0 8px!important;transition:background .15s ease,color .15s ease,box-shadow .15s ease}',
    '[class*="_tabList"]>div[draggable="true"][class*="_tabActive"]{background:var(--dsw-alias-bg-layer-2)!important;'
      + 'box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}',
    '[class*="_tabBarPlus"]{margin:0 2px!important;background:transparent!important;border-radius:8px!important}',
    '[class*="_bottomClose"]{top:6px!important}',
    '[class*="_explorerBody"]{box-sizing:border-box;margin:4px 8px 8px;padding:4px!important;'
      + 'border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
    '[class*="_explorerRow"]{height:36px!important;border-radius:10px!important;padding-right:10px!important}',
    '[class*="_grid"]:has(>[class*="_card"] [class*="_cardMain"])>[class*="_card"]{border:0!important;box-shadow:none!important}',
    '[class*="_browserBar"]>[class*="_iconButton"]:last-child{width:24px!important;height:24px!important}',
    '.dsh-provider-native{display:none!important}',
    '.dsh-provider-picker{display:grid;width:100%;gap:8px}',
    '.dsh-provider-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;'
      + 'font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-secondary)}',
    '.dsh-provider-heading small{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}',
    '.dsh-provider-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
    '.dsh-provider-option{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-width:0;min-height:52px;'
      + 'padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;'
      + 'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;'
      + 'transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),'
      + 'border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}',
    '.dsh-provider-option:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}',
    '.dsh-provider-option[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active);'
      + 'border-color:var(--dsw-alias-interactive-bg-hover-accent)}',
    '.dsh-provider-option:focus-visible,.dsh-provider-more>summary:focus-visible{outline:2px solid '
      + 'var(--dsw-alias-interactive-bg-hover-accent);outline-offset:2px}',
    '.dsh-provider-logo{display:grid;place-items:center;flex:none;width:30px;height:30px;'
      + 'border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:#fff}',
    '.dsh-provider-logo svg{display:block;width:21px;height:21px}',
    '.dsh-provider-copy{display:grid;min-width:0;gap:1px;flex:1}',
    '.dsh-provider-copy strong{overflow:hidden;font:var(--dsw-font-xxs-strong-12);text-overflow:ellipsis;white-space:nowrap}',
    '.dsh-provider-copy small{overflow:hidden;color:var(--dsw-alias-label-tertiary);'
      + 'font:var(--dsw-font-xxxs-11);text-overflow:ellipsis;white-space:nowrap}',
    '.dsh-provider-check{display:grid;place-items:center;flex:none;width:16px;height:16px;opacity:0;'
      + 'color:var(--dsw-alias-brand-primary)}',
    '.dsh-provider-option[aria-pressed="true"] .dsh-provider-check{opacity:1}',
    '.dsh-provider-check svg{width:14px;height:14px}',
    '.dsh-provider-more{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;'
      + 'background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
    '.dsh-provider-more>summary{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:44px;'
      + 'padding:0 12px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-strong-12);'
      + 'cursor:pointer;list-style:none}',
    '.dsh-provider-more>summary::-webkit-details-marker{display:none}',
    '.dsh-provider-more>summary:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    '.dsh-provider-more-count{margin-left:auto;padding:1px 7px;border-radius:999px;'
      + 'background:var(--dsw-alias-interactive-bg-hover);font:var(--dsw-font-xxxs-11)}',
    '.dsh-provider-chevron{display:grid;place-items:center;'
      + 'transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out)}',
    '.dsh-provider-chevron svg{width:14px;height:14px}',
    '.dsh-provider-more[open] .dsh-provider-chevron{transform:rotate(180deg)}',
    '.dsh-provider-more .dsh-provider-grid{padding:0 8px 8px}',
    '.dsh-provider-option-secondary{min-height:44px}',
    '.dsh-provider-option-secondary .dsh-provider-copy small{display:none}',
    '#dsh-desktop-pet-setting .dsh-pet-switch{box-sizing:border-box;display:block;flex:none;width:30px;height:18px;'
      + 'margin-left:auto;padding:2px;border-radius:999px;background:var(--dsw-alias-border-l2,#d8d8d4);'
      + 'transition:background .15s ease}',
    '#dsh-desktop-pet-setting .dsh-pet-switch::after{display:block;width:14px;height:14px;border-radius:50%;'
      + 'background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(0,0,0,.2);content:"";'
      + 'transition:transform .15s ease}',
    '#dsh-desktop-pet-setting[aria-checked="true"] .dsh-pet-switch{background:var(--dsw-alias-brand-primary,#0f1115)}',
    '#dsh-desktop-pet-setting[aria-checked="true"] .dsh-pet-switch::after{transform:translateX(12px)}',
    '#dsh-desktop-pet-setting:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent);outline-offset:2px}',
    '.zat-sid{display:none!important}',
    '.dsh-session-tabs{display:flex;gap:4px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
    '.dsh-session-tab{min-height:44px;padding:0 14px;border:0;border-radius:8px;background:transparent;'
      + 'color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-strong-12);cursor:pointer}',
    '.dsh-session-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dsh-session-tab[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
    '.dsh-session-tab:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent);outline-offset:2px}',
    '.zat-cols.dsh-session-enhanced{grid-template-columns:minmax(0,1fr)!important}',
    '.zat-cols.dsh-session-enhanced>.zat-col .zat-colhead{display:none}',
    '.zat-cols.dsh-session-enhanced>.zat-col[hidden]{display:none!important}',
    '@media (max-width:720px){.dsh-provider-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@media (prefers-reduced-motion:reduce){[class*="_tabList"]>div[draggable="true"],'
      + '.dsh-provider-option,.dsh-provider-chevron,#dsh-desktop-pet-setting .dsh-pet-switch,'
      + '#dsh-desktop-pet-setting .dsh-pet-switch::after{transition:none}}',
  ].join('')
  document.head.appendChild(style)
}

/** Keep the four optional desktop-plugin pages behind one compact nav row. */
function foldExtraSettings(): void {
  const nav = findSettingsDialog()?.querySelector('[class*="navList"]')
  if (nav === undefined || nav === null || nav.querySelector('#' + MORE_SETTINGS_ID) !== null) return
  const items = [...nav.children].filter(item => FOLDED_SETTINGS.has(item.textContent?.trim() ?? '')) as HTMLElement[]
  const first = items[0]
  if (first === undefined) return

  const more = first.cloneNode(true) as HTMLButtonElement
  more.id = MORE_SETTINGS_ID
  more.removeAttribute('aria-current')
  const label = more.querySelector('[class*="navLabel"]')
  if (label === null) return
  label.textContent = '更多'
  const activeClass = [...(nav.querySelector('[aria-current="true"]')?.classList ?? [])]
    .find(name => name.toLowerCase().includes('active'))
  let open = false
  const paint = (): void => {
    for (const item of items) item.style.display = open ? '' : 'none'
    more.setAttribute('aria-expanded', String(open))
    if (activeClass !== undefined) {
      more.classList.toggle(activeClass, !open && items.some(item => item.getAttribute('aria-current') === 'true'))
    }
  }
  more.addEventListener('click', () => {
    open = !open
    paint()
  })
  nav.append(more, ...items)
  paint()
}

function petVisible(): boolean {
  return document.documentElement.hasAttribute('data-dsh-pet-visible')
}

function storedPetVisible(): boolean {
  try {
    return localStorage.getItem(PET_VISIBILITY_KEY) === 'true'
  } catch {
    return false
  }
}

function setPetVisible(visible: boolean): void {
  document.documentElement.toggleAttribute('data-dsh-pet-visible', visible)
  try {
    localStorage.setItem(PET_VISIBILITY_KEY, String(visible))
  } catch { /* remote origins can deny storage; the current view still updates */ }
}

/** Hide the optional Harness Pet before it mounts, without patching its package. */
function injectPetVisibilityGuard(): void {
  if (document.documentElement === null) {
    document.addEventListener('readystatechange', injectPetVisibilityGuard, { once: true })
    return
  }
  setPetVisible(storedPetVisible())
  if (document.getElementById(PET_VISIBILITY_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = PET_VISIBILITY_STYLE_ID
  style.textContent = 'html:not([data-dsh-pet-visible]) #harness-pet-root{display:none!important}'
  ;(document.head ?? document.documentElement).appendChild(style)
}

/** Add one persisted whale switch under the existing More disclosure. */
function injectPetSetting(): void {
  if (document.getElementById('harness-pet-root') === null) return
  const more = document.getElementById(MORE_SETTINGS_ID) as HTMLButtonElement | null
  if (more === null || document.getElementById(PET_SETTING_ID) !== null) return
  const item = more.cloneNode(true) as HTMLButtonElement
  item.id = PET_SETTING_ID
  item.type = 'button'
  item.setAttribute('role', 'switch')
  item.removeAttribute('aria-current')
  item.removeAttribute('aria-expanded')
  const label = item.querySelector('[class*="navLabel"]')
  if (label === null) return
  label.textContent = '小鲸鱼'
  const toggle = document.createElement('span')
  toggle.className = 'dsh-pet-switch'
  toggle.setAttribute('aria-hidden', 'true')
  item.append(toggle)
  const paint = (): void => {
    const visible = petVisible()
    item.setAttribute('aria-checked', String(visible))
    item.setAttribute('aria-label', visible ? '隐藏小鲸鱼' : '显示小鲸鱼')
    item.style.display = more.getAttribute('aria-expanded') === 'true' ? '' : 'none'
  }
  item.addEventListener('click', () => {
    setPetVisible(!petVisible())
    paint()
  })
  more.addEventListener('click', paint)
  more.after(item)
  paint()
}

function settingsNavIcon(name: string, className: string): SVGSVGElement | null {
  const paths = SETTINGS_NAV_ICON_PATHS[name]
  if (paths === undefined) return null
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '2')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  icon.className.baseVal = className
  icon.dataset.dshNavIcon = name
  icon.innerHTML = paths
  return icon
}

/** Give every desktop-added settings page its own semantic vector icon. */
function polishSettingsNavigation(): void {
  const nav = findSettingsDialog()?.querySelector('[class*="navList"]')
  if (nav === undefined || nav === null) return
  for (const item of nav.children) {
    const label = item.querySelector('[class*="navLabel"]')
    if (label === null) continue
    let name = (label.textContent ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
    if (name === '对话管理') {
      name = '归档管理'
      label.textContent = name
    }
    const current = item.querySelector('svg') as SVGSVGElement | null
    if (current?.dataset.dshNavIcon === name) continue
    const icon = settingsNavIcon(name, current?.getAttribute('class') ?? '')
    if (icon !== null) current?.replaceWith(icon)
  }
}

/** Turn the plugin's two-column session dump into an archive-first tab view. */
function polishSessionManager(): void {
  const dialog = findSettingsDialog()
  if (dialog === null) return
  const panel = [...dialog.querySelectorAll('.zat-panel')].find(item =>
    [...item.querySelectorAll('.zat-colhead')].some(head => /归档管理|Archived/.test(head.textContent ?? '')))
  if (panel === undefined) return

  const title = panel.querySelector('.zat-title')
  if (title?.firstChild !== null && title?.firstChild !== undefined) title.firstChild.textContent = '归档管理'
  for (const sessionTitle of panel.querySelectorAll('.zat-stitle')) sessionTitle.removeAttribute('title')

  const columns = [...panel.querySelectorAll<HTMLElement>('.zat-cols > .zat-col')]
  if (columns.length < 2) return
  const archived = columns.find(column => /归档管理|Archived/.test(column.querySelector('.zat-colhead')?.textContent ?? '')) ?? columns[1]
  const active = columns.find(column => column !== archived) ?? columns[0]
  if (archived === undefined || active === undefined) return
  const cols = archived.parentElement
  if (cols === null) return
  cols.classList.add('dsh-session-enhanced')
  archived.id = 'dsh-session-archived-panel'
  active.id = 'dsh-session-active-panel'
  archived.setAttribute('role', 'tabpanel')
  active.setAttribute('role', 'tabpanel')

  let tabs = panel.querySelector<HTMLElement>('.dsh-session-tabs')
  if (tabs === null) {
    const newTabs = document.createElement('div')
    newTabs.className = 'dsh-session-tabs'
    newTabs.setAttribute('role', 'tablist')
    newTabs.setAttribute('aria-label', '会话列表')
    const definitions: Array<[string, string, string]> = [
      ['archived', '归档列表', archived.id],
      ['active', '进行中', active.id],
    ]
    for (const [key, label, controls] of definitions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-session-tab'
      button.dataset.sessionTab = key
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-controls', controls)
      button.textContent = label
      newTabs.append(button)
    }
    newTabs.dataset.selected = 'archived'
    newTabs.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-session-tab]')
      if (button === null) return
      newTabs.dataset.selected = button.dataset.sessionTab
      polishSessionManager()
    })
    newTabs.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      newTabs.dataset.selected = newTabs.dataset.selected === 'archived' ? 'active' : 'archived'
      polishSessionManager()
      newTabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    })
    cols.before(newTabs)
    tabs = newTabs
  }

  const selected = tabs.dataset.selected ?? 'archived'
  for (const button of tabs.querySelectorAll<HTMLButtonElement>('[data-session-tab]')) {
    const on = button.dataset.sessionTab === selected
    button.setAttribute('aria-selected', String(on))
    button.tabIndex = on ? 0 : -1
  }
  archived.hidden = selected !== 'archived'
  active.hidden = selected !== 'active'
}

function isChineseProvider(value: string): boolean {
  return CHINESE_PROVIDER_PREFIXES.some(prefix => value === prefix || value.startsWith(prefix + '-'))
}

function providerOrder(a: HTMLOptionElement, b: HTMLOptionElement): number {
  if (a.value === 'deepseek') return -1
  if (b.value === 'deepseek') return 1
  return Number(isChineseProvider(b.value)) - Number(isChineseProvider(a.value))
    || a.value.localeCompare(b.value, 'en')
}

function paintProviderPicker(picker: Element, value: string): void {
  for (const option of picker.querySelectorAll<HTMLButtonElement>('[data-provider-value]')) {
    option.setAttribute('aria-pressed', String(option.dataset.providerValue === value))
  }
}

function providerButton(option: HTMLOptionElement, select: HTMLSelectElement, picker: Element): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dsh-provider-option'
  button.dataset.providerValue = option.value
  button.disabled = option.disabled
  button.title = option.value
  button.setAttribute('aria-label', (PROVIDER_NAMES[option.value] ?? option.textContent) + ' (' + option.value + ')')

  const logo = providerLogo(option.value)
  if (logo !== undefined) {
    const icon = document.createElement('span')
    icon.className = 'dsh-provider-logo'
    icon.innerHTML = logo
    button.append(icon)
  } else {
    button.classList.add('dsh-provider-option-secondary')
  }

  const copy = document.createElement('span')
  copy.className = 'dsh-provider-copy'
  const name = document.createElement('strong')
  name.textContent = PROVIDER_NAMES[option.value] ?? option.textContent
  const id = document.createElement('small')
  id.textContent = option.value
  copy.append(name, id)

  const check = document.createElement('span')
  check.className = 'dsh-provider-check'
  check.setAttribute('aria-hidden', 'true')
  check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>'
  button.append(copy, check)
  button.addEventListener('click', () => {
    select.value = option.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    paintProviderPicker(picker, option.value)
  })
  return button
}

/** Chinese providers are primary logo cards; everything else stays behind native disclosure. */
function enhanceProviderOptions(): void {
  const dialog = findSettingsDialog()
  if (dialog === null) return
  for (const element of dialog.querySelectorAll('select')) {
    const select = element as HTMLSelectElement
    if (!/^(提供方|Provider)$/i.test(select.getAttribute('aria-label') ?? '')) continue
    const field = select.parentElement
    if (field === null) continue
    const card = select.closest<HTMLElement>('[class*="_addCard"]')
    if (card !== null && card.dataset.dshProviderDefault !== 'true' && select.getClientRects().length > 0
      && [...select.options].some(option => option.value === 'deepseek')) {
      card.dataset.dshProviderDefault = 'true'
      select.value = 'deepseek'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const existing = field.querySelector(':scope > .dsh-provider-picker')
    if (select.dataset.dshProviderPicker === 'true' && existing !== null) {
      paintProviderPicker(existing, select.value)
      continue
    }
    existing?.remove()

    const sorted = [...select.options].filter(option => option.value !== '').sort(providerOrder)
    for (const option of sorted) select.append(option)
    select.dataset.dshProviderPicker = 'true'
    select.classList.add('dsh-provider-native')
    select.setAttribute('aria-hidden', 'true')
    select.tabIndex = -1

    const english = select.getAttribute('aria-label') === 'Provider'
    const picker = document.createElement('div')
    picker.className = 'dsh-provider-picker'
    const heading = document.createElement('div')
    heading.className = 'dsh-provider-heading'
    heading.append(english ? 'China providers' : '中国模型服务')
    const hint = document.createElement('small')
    hint.textContent = english ? 'Recommended first' : '优先显示'
    heading.append(hint)

    const primary = document.createElement('div')
    primary.className = 'dsh-provider-grid'
    for (const option of sorted.filter(item => isChineseProvider(item.value))) {
      primary.append(providerButton(option, select, picker))
    }

    const secondary = sorted.filter(item => !isChineseProvider(item.value))
    const more = document.createElement('details')
    more.className = 'dsh-provider-more'
    const summary = document.createElement('summary')
    summary.append(english ? 'More providers' : '更多提供方')
    const count = document.createElement('span')
    count.className = 'dsh-provider-more-count'
    count.textContent = String(secondary.length)
    const chevron = document.createElement('span')
    chevron.className = 'dsh-provider-chevron'
    chevron.setAttribute('aria-hidden', 'true')
    chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
    summary.append(count, chevron)
    const secondaryGrid = document.createElement('div')
    secondaryGrid.className = 'dsh-provider-grid'
    for (const option of secondary) secondaryGrid.append(providerButton(option, select, picker))
    more.append(summary, secondaryGrid)

    picker.append(heading, primary, more)
    select.after(picker)
    paintProviderPicker(picker, select.value)
  }
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
    if (child.id === ENHANCE_ID || child.id === UPDATE_ID) continue
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
      '#' + ENHANCE_ID + ' .dsh-enhance-row{display:flex;gap:8px;align-items:center}',
      '#' + ENHANCE_ID + ' .dsh-enhance-input{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#D8D8D4);border-radius:8px;padding:6px 10px;font-size:13px;color:var(--dsw-alias-label-primary,#0F1115);outline:none}',
      '#' + ENHANCE_ID + ' .dsh-enhance-input:focus{border-color:var(--dsw-alias-brand-primary,#0F1115)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-input::placeholder{color:var(--dsw-alias-label-dimmed,#9AA0A6)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-actions{display:flex;gap:8px;align-items:center;margin-left:auto}',
      '#' + ENHANCE_ID + ' .dsh-enhance-button{white-space:nowrap;font-weight:400;background:transparent;border:1px solid var(--dsw-alias-border-l2,#D8D8D4);border-radius:28px;padding:6px 16px;font-size:13px;color:var(--dsw-alias-label-primary,#0F1115);cursor:pointer;transition:background .15s ease,opacity .15s ease}',
      '#' + ENHANCE_ID + ' .dsh-enhance-button:hover{background:var(--dsw-alias-interactive-bg-hover,#F5F6F7)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-button:disabled{cursor:default;opacity:.55}',
      '#' + ENHANCE_ID + ' .dsh-enhance-switch{background:var(--dsw-alias-label-primary,#0F1115);border-color:var(--dsw-alias-label-primary,#0F1115);color:var(--dsw-alias-bg-layer-1,#fff)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-switch:hover{opacity:.88;background:var(--dsw-alias-label-primary,#0F1115)}',
      '#' + ENHANCE_ID + ' .dsh-enhance-note{margin:10px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#6E7480)}',
      '#' + UPDATE_ID + '{margin:0;padding:16px 0}',
      '#' + UPDATE_ID + ' .dsh-update-title{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary,#0F1115)}',
      '#' + UPDATE_ID + ' .dsh-enhance-badge{font-size:12px;font-weight:400;color:var(--dsw-alias-label-primary,#0F1115);background:var(--dsw-alias-bg-module-platform,#EBEEF2);border-radius:999px;padding:2px 8px}',
      '#' + UPDATE_ID + ' .dsh-update-version{margin:0 0 4px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8A9099)}',
      '#' + UPDATE_ID + ' .dsh-update-status{margin:0 0 8px;font-size:13px;color:var(--dsw-alias-label-secondary,#6E7480)}',
      '#' + UPDATE_ID + ' .dsh-update-status.is-error{color:var(--dsw-alias-status-error,#D93F3F)}',
      // The notes are release Markdown; the stylesheet for what it renders
      // into is shared with the client's own settings page.
      releaseNotesCss('#' + UPDATE_ID + ' .dsh-update-notes', {
        text: 'var(--dsw-alias-label-secondary,#6E7480)',
        strong: 'var(--dsw-alias-label-primary,#0F1115)',
        border: 'var(--dsw-alias-border-l2,#D8D8D4)',
        surface: 'var(--dsw-alias-bg-module-platform,#EBEEF2)',
      }),
      '#' + UPDATE_ID + ' .dsh-update-bar{height:4px;margin:0 0 10px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#EBEEF2);overflow:hidden}',
      '#' + UPDATE_ID + ' .dsh-update-bar span{display:block;height:100%;width:0;border-radius:999px;background:var(--dsw-alias-label-primary,#0F1115);transition:width .2s ease}',
      '#' + UPDATE_ID + ' .dsh-enhance-actions{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap}',
      '#' + UPDATE_ID + ' .dsh-enhance-button{white-space:nowrap;font-weight:400;background:transparent;border:1px solid var(--dsw-alias-border-l2,#D8D8D4);border-radius:28px;padding:6px 16px;font-size:13px;color:var(--dsw-alias-label-primary,#0F1115);cursor:pointer;transition:background .15s ease,opacity .15s ease}',
      '#' + UPDATE_ID + ' .dsh-enhance-button:hover{background:var(--dsw-alias-interactive-bg-hover,#F5F6F7)}',
      '#' + UPDATE_ID + ' .dsh-enhance-button:disabled{cursor:default;opacity:.55}',
      '#' + UPDATE_ID + ' .dsh-enhance-switch{background:var(--dsw-alias-label-primary,#0F1115);border-color:var(--dsw-alias-label-primary,#0F1115);color:var(--dsw-alias-bg-layer-1,#fff)}',
      '#' + UPDATE_ID + ' .dsh-enhance-switch:hover{opacity:.88;background:var(--dsw-alias-label-primary,#0F1115)}',
      // A glyph rather than a fourth button: the row keeps one primary action,
      // and this stays a way out rather than a competing choice.
      '#' + UPDATE_ID + ' .dsh-update-link{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;'
        + 'border-radius:999px;text-decoration:none;color:var(--dsw-alias-label-secondary,#6E7480);'
        + 'transition:background .15s ease,color .15s ease}',
      '#' + UPDATE_ID + ' .dsh-update-link:hover{background:var(--dsw-alias-interactive-bg-hover,#F5F6F7);color:var(--dsw-alias-label-primary,#0F1115)}',
    ].join('')
    document.head.appendChild(style)
  }

  const block = document.createElement('div')
  block.id = ENHANCE_ID
  block.innerHTML =
    '<div class="dsh-enhance-title">连接<span class="dsh-enhance-badge">增强功能</span>'
    + '<div class="dsh-enhance-actions">'
    + '<button class="dsh-enhance-button dsh-enhance-switch" id="dsh-enhance-switch" type="button" hidden>切换连接</button>'
    + '<button class="dsh-enhance-button" id="dsh-enhance-save" type="button">保存并连接</button>'
    + '</div></div>'
    + '<p class="dsh-enhance-status" id="dsh-enhance-status">连接状态读取中…</p>'
    + '<div class="dsh-enhance-row">'
    + '<input class="dsh-enhance-input" id="dsh-enhance-url" spellcheck="false" placeholder="Web UI 地址，留空 = 智能（本机官方实例优先，否则本地启动）">'
    + '</div>'
    + '<p class="dsh-enhance-note" id="dsh-enhance-note"></p>'
  const statusEl = block.querySelector('#dsh-enhance-status') as HTMLElement
  const urlEl = block.querySelector('#dsh-enhance-url') as HTMLInputElement
  const noteEl = block.querySelector('#dsh-enhance-note') as HTMLElement
  const switchEl = block.querySelector('#dsh-enhance-switch') as HTMLButtonElement
  block.querySelector('#dsh-enhance-save')?.addEventListener('click', async () => {
    try {
      const result = await connection.saveServerUrl(urlEl.value.trim())
      noteEl.textContent = result.saved
        ? (result.mode === 'smart' ? '正在连接（智能模式：该实例停止时自动回落）' : '已保存，正在连接…')
        : ('保存失败：' + (result.error ?? '未知错误'))
    } catch (error) {
      noteEl.textContent = '保存失败：' + (error instanceof Error ? error.message : String(error))
    }
  })
  switchEl.addEventListener('click', async () => {
    switchEl.disabled = true
    try {
      const result = await connection.switchMode()
      noteEl.textContent = result.switched ? '正在切换…' : ('切换失败：' + (result.error ?? '未知错误'))
      if (!result.switched) switchEl.disabled = false
    } catch (error) {
      noteEl.textContent = '切换失败：' + (error instanceof Error ? error.message : String(error))
      switchEl.disabled = false
    }
  })
  void connection.getStatus().then((status) => {
    // Named by WHO started the runtime, then which dsh it is — "本地"/"内置"
    // used to overlap, and a reused instance the user started got neither.
    const version = status.installedDshVersion === undefined ? '' : ' v' + status.installedDshVersion
    const startedByClient = status.runtimeSource === 'installed'
      ? '客户端启动·本机安装的 dsh' + version
      : status.runtimeSource === 'npx'
        ? '客户端启动·npx 缓存的 dsh' + version
        : status.runtimeSource === 'bundled' ? '客户端启动·内置运行时' : '客户端启动'
    const modeLabel = status.mode === 'probe'
      ? '复用你已启动的 dsh'
      : status.mode === 'connect' ? '固定地址' : startedByClient
    statusEl.textContent = modeLabel + ' → ' + (status.targetUrl || '（未就绪）')
      + (status.childPid !== undefined ? ' · PID ' + String(status.childPid) : '')
      + (status.lastError !== undefined ? ' · ' + status.lastError : '')
      // Non-blocking: the cache stays in use; re-running npx is how it updates.
      + (status.mode === 'local' && status.npxCacheOutdated === true
        ? ' · npx 缓存低于内置' + (status.dshVersion === null ? '' : ' v' + status.dshVersion) + '，重新运行 npx 可更新'
        : '')
    urlEl.value = status.savedServerUrl
    switchEl.hidden = status.selectedMode !== 'connect'
    switchEl.textContent = '切换到智能模式'
    // Nothing saved: offer a live official instance on the default port, so
    // switching to it is one click. Never overwrite a value already in the box.
    if (status.savedServerUrl !== '') return
    void connection.probeLocal().then((probe) => {
      if (probe.url === null || probe.url === status.targetUrl || urlEl.value !== '') return
      urlEl.value = probe.url
      noteEl.textContent = '检测到你已启动的 dsh。点击「保存并连接」即可使用；它停止时客户端会自动回落。'
    }).catch(() => { /* the offer is a convenience; its absence is not an error */ })
  }).catch(() => { statusEl.textContent = '连接状态不可用' })
  panel.appendChild(block)
}

function updateCopy(english: boolean): {
  title: string
  badge: string
  check: string
  checking: string
  install: string
  dismiss: string
  releases: string
  upToDate: string
  found: string
  preparing: string
  downloading: string
  installing: string
  restart: string
  failed: string
  failedNoReason: string
  cancelled: string
  unknown: string
  unavailable: string
  client: string
  bundled: string
  dshUnavailable: string
} {
  if (english) {
    return {
      title: 'App updates',
      badge: 'Enhanced',
      check: 'Check for updates',
      checking: 'Checking…',
      install: 'Download and install',
      dismiss: 'Remind me later',
      releases: 'Open the releases page to download manually',
      upToDate: 'You are on the latest version',
      found: 'New version available',
      preparing: 'Preparing the download…',
      downloading: 'Downloading',
      installing: 'Starting the installer…',
      restart: 'Install the new copy, then reopen the app',
      failed: 'Update failed: ',
      failedNoReason: 'Update failed — the reason is shown on the client itself',
      cancelled: 'Update cancelled',
      unknown: 'unknown error',
      unavailable: 'Update status unavailable',
      client: 'Desktop client v',
      bundled: 'bundled dsh',
      dshUnavailable: 'unavailable',
    }
  }
  return {
    title: '应用更新',
    badge: '增强功能',
    check: '检查更新',
    checking: '检查中…',
    install: '下载并安装',
    dismiss: '稍后提醒',
    releases: '打开 GitHub 发布页手动下载',
    upToDate: '已是最新版本',
    found: '发现新版本',
    preparing: '正在准备下载…',
    downloading: '下载中',
    installing: '正在启动安装程序…',
    restart: '请安装新版本后重新打开应用',
    failed: '更新失败：',
    failedNoReason: '更新失败，失败原因只在客户端本机显示',
    cancelled: '已取消更新',
    unknown: '未知错误',
    unavailable: '更新状态不可用',
    client: '桌面客户端 v',
    bundled: '内置 dsh',
    dshUnavailable: '不可用',
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message === '' ? fallback : error.message
  const text = String(error)
  return text === '' ? fallback : text
}

/** MB, one decimal — the only unit an installer download ever needs. */
function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1)
}

/**
 * A message the card owns rather than the state: the refusals that never reach
 * a phase change (a denied bridge call, a rejected invoke) would otherwise
 * leave the button looking dead.
 */
function showUpdateMessage(text: string, isError: boolean): void {
  const statusEl = document.getElementById(UPDATE_ID)?.querySelector('#dsh-update-status') as HTMLElement | null
  if (statusEl === null || statusEl === undefined) return
  statusEl.hidden = false
  statusEl.textContent = text
  statusEl.classList.toggle('is-error', isError)
}

/** The notes source each notes box currently shows, keyed by the box itself. */
const paintedNotes = new WeakMap<HTMLElement, string>()

function paintUpdateCard(state: UpdateState, english: boolean): void {
  const block = document.getElementById(UPDATE_ID)
  if (block === null) return
  const copy = updateCopy(english)
  const versionEl = block.querySelector('#dsh-update-version') as HTMLElement | null
  const statusEl = block.querySelector('#dsh-update-status') as HTMLElement | null
  const notesEl = block.querySelector('#dsh-update-notes') as HTMLElement | null
  const barEl = block.querySelector('#dsh-update-bar') as HTMLElement | null
  const barFillEl = block.querySelector('#dsh-update-bar span') as HTMLElement | null
  const checkEl = block.querySelector('#dsh-update-check') as HTMLButtonElement | null
  const installEl = block.querySelector('#dsh-update-install') as HTMLButtonElement | null
  const dismissEl = block.querySelector('#dsh-update-dismiss') as HTMLButtonElement | null
  if (versionEl === null || statusEl === null || notesEl === null || checkEl === null || installEl === null || dismissEl === null) return
  if (barEl === null || barFillEl === null) return

  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing'
  checkEl.disabled = busy
  checkEl.textContent = state.phase === 'checking' ? copy.checking : copy.check
  // A failed attempt keeps the offer on screen: the update is still there and
  // retrying is the obvious next move. Without this the state would say
  // "hide" while the click handler said "show", and they would fight.
  const showInstall = (state.phase === 'available' || state.phase === 'error') && state.info !== null && !busy
  installEl.hidden = !showInstall
  dismissEl.hidden = !showInstall || state.dismissed
  installEl.disabled = busy

  const dsh = block.dataset.dshVersion || copy.dshUnavailable
  versionEl.textContent = copy.client + state.currentVersion + ' · ' + copy.bundled + ' ' + dsh

  let line = ''
  if (state.phase === 'checking') line = copy.checking
  else if (state.phase === 'upToDate') line = copy.upToDate
  else if (state.phase === 'available' && state.info !== null) line = copy.found + ' v' + state.info.availableVersion
  else if (state.phase === 'downloading') {
    // A download with no percentage still has to look alive, so the byte
    // counter carries it when the response arrives without a content-length.
    const progress = state.progress
    const percent = progress?.percent ?? 0
    const total = progress?.total ?? 0
    line = copy.downloading + (percent > 0 ? ' ' + String(percent) + '%' : '…')
    if (progress !== null && progress.downloaded > 0) {
      line += ' · ' + megabytes(progress.downloaded) + (total > 0 ? '/' + megabytes(total) : '') + ' MB'
    }
  } else if (state.phase === 'installing') line = copy.installing
  else if (state.phase === 'restartRequired') line = copy.restart
  // A refusal leaves the phase alone and publishes only a reason, so the
  // reason — not the phase — is what decides this line.
  const failed = state.phase === 'error' || state.error !== null
  // A remote page never receives the reason (it names local paths), so say
  // where the reason is rather than inventing one.
  if (failed) line = state.error === null ? copy.failedNoReason : copy.failed + state.error
  statusEl.textContent = line
  statusEl.hidden = line === ''
  statusEl.classList.toggle('is-error', failed)

  const downloading = state.phase === 'downloading'
  barEl.hidden = !downloading
  if (downloading) barFillEl.style.width = String(state.progress?.percent ?? 0) + '%'

  const notes = state.info?.notes ?? ''
  notesEl.hidden = notes === ''
  // Rebuilding the box resets its scroll position and drops any selection, and
  // a download repaints this card several times a second — so it is rebuilt
  // only when the source text actually moved.
  if (paintedNotes.get(notesEl) !== notes) {
    paintedNotes.set(notesEl, notes)
    notesEl.innerHTML = renderReleaseNotes(notes)
  }
}

/**
 * The labels the card owns rather than the state. The official language
 * setting can change while the card is on screen, and the card is only
 * rebuilt when its panel goes away — so these are retexted in place instead
 * of waiting for the next injection.
 */
function applyUpdateStaticCopy(block: HTMLElement, english: boolean): void {
  const copy = updateCopy(english)
  const setText = (selector: string, text: string): void => {
    const el = block.querySelector(selector)
    if (el !== null) el.textContent = text
  }
  setText('#dsh-update-title-text', copy.title)
  setText('#dsh-update-badge', copy.badge)
  setText('#dsh-update-install', copy.install)
  setText('#dsh-update-dismiss', copy.dismiss)
  const link = block.querySelector('#dsh-update-releases')
  if (link !== null) {
    link.setAttribute('title', copy.releases)
    link.setAttribute('aria-label', copy.releases)
  }
  // The check button doubles as a progress label while a check runs, and that
  // wording belongs to paintUpdateCard — only the resting label is ours.
  const checkEl = block.querySelector('#dsh-update-check') as HTMLButtonElement | null
  if (checkEl !== null && !checkEl.disabled) checkEl.textContent = copy.check
}

/** Follow a mid-session language switch, without repainting on every probe. */
function refreshUpdateLanguage(block: HTMLElement, english: boolean): void {
  const language = english ? 'en' : 'zh'
  if (block.dataset.dshLanguage === language) return
  block.dataset.dshLanguage = language
  applyUpdateStaticCopy(block, english)
  // The state-derived lines (version, status, notes) are painted from a state,
  // so the new language reaches them only by painting one now.
  void update.getStatus().then((state) => { paintUpdateCard(state, english) }).catch(() => {})
}

function injectUpdate(panel: Element): void {
  if (panel.querySelector('#' + UPDATE_ID) !== null) return
  const english = currentEnglish()
  const copy = updateCopy(english)
  const block = document.createElement('div')
  block.id = UPDATE_ID
  block.dataset.dshLanguage = english ? 'en' : 'zh'
  block.innerHTML =
    '<div class="dsh-update-title"><span id="dsh-update-title-text">' + copy.title + '</span>'
    + '<span class="dsh-enhance-badge" id="dsh-update-badge">' + copy.badge + '</span>'
    + '<div class="dsh-enhance-actions">'
    + '<a class="dsh-update-link" id="dsh-update-releases" href="' + RELEASES_PAGE_URL + '" target="_blank"'
    + ' rel="noreferrer" title="' + copy.releases + '" aria-label="' + copy.releases + '">' + EXTERNAL_LINK_SVG + '</a>'
    + '<button class="dsh-enhance-button dsh-enhance-switch" id="dsh-update-install" type="button" hidden>' + copy.install + '</button>'
    + '<button class="dsh-enhance-button" id="dsh-update-check" type="button">' + copy.check + '</button>'
    + '<button class="dsh-enhance-button" id="dsh-update-dismiss" type="button" hidden>' + copy.dismiss + '</button>'
    + '</div></div>'
    + '<p class="dsh-update-version" id="dsh-update-version"></p>'
    + '<p class="dsh-update-status" id="dsh-update-status" hidden></p>'
    + '<div class="dsh-update-bar" id="dsh-update-bar" hidden><span></span></div>'
    + '<div class="dsh-update-notes" id="dsh-update-notes" hidden></div>'
  // Every handler resolves the language when it runs, not when it was
  // attached: the card outlives a language switch made in this same dialog.
  block.querySelector('#dsh-update-check')?.addEventListener('click', () => {
    const live = updateCopy(currentEnglish())
    showUpdateMessage(live.checking, false)
    void update.check()
      .then(() => update.getStatus())
      .then((state) => { paintUpdateCard(state, currentEnglish()) })
      .catch((error: unknown) => { showUpdateMessage(live.failed + errorText(error, live.unknown), true) })
  })
  const installEl = block.querySelector('#dsh-update-install') as HTMLButtonElement | null
  installEl?.addEventListener('click', () => {
    // The install runs to completion inside one invoke, so the answer arrives
    // minutes later. Say something now, and treat every way it can come back
    // unstarted — a refusal in the result, a rejected call — as a message.
    // Visibility stays with the state; only the disabled flag is ours.
    installEl.disabled = true
    showUpdateMessage(updateCopy(currentEnglish()).preparing, false)
    void update.install()
      .then((result) => update.getStatus().then((state) => {
        const live = updateCopy(currentEnglish())
        paintUpdateCard(state, currentEnglish())
        if (result.started) return
        installEl.disabled = false
        // Declining the confirmation is an answer, not a failure.
        if (result.cancelled === true) showUpdateMessage(live.cancelled, false)
        else showUpdateMessage(live.failed + (result.error ?? live.unknown), true)
      }))
      .catch((error: unknown) => {
        const live = updateCopy(currentEnglish())
        installEl.disabled = false
        showUpdateMessage(live.failed + errorText(error, live.unknown), true)
      })
  })
  block.querySelector('#dsh-update-dismiss')?.addEventListener('click', () => {
    void update.dismiss().then(() => update.getStatus()).then((state) => { paintUpdateCard(state, currentEnglish()) }).catch(() => {})
  })
  panel.appendChild(block)
  void Promise.allSettled([update.getStatus(), connection.getStatus()]).then((results) => {
    const state = results[0].status === 'fulfilled' ? results[0].value : null
    const conn = results[1].status === 'fulfilled' ? results[1].value : null
    if (conn !== null) block.dataset.dshVersion = conn.dshVersion ?? ''
    if (state !== null) {
      paintUpdateCard(state, currentEnglish())
      return
    }
    const statusEl = block.querySelector('#dsh-update-status') as HTMLElement | null
    if (statusEl !== null) {
      statusEl.hidden = false
      statusEl.textContent = updateCopy(currentEnglish()).unavailable
    }
  })
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
  document.addEventListener('click', (event) => {
    const label = (event.target as Element).closest('button')?.textContent?.trim() ?? ''
    if (!/^(添加提供方|Add provider)$/i.test(label)) return
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const select = [...(findSettingsDialog()?.querySelectorAll<HTMLSelectElement>('select') ?? [])]
        .find(item => /^(提供方|Provider)$/i.test(item.getAttribute('aria-label') ?? ''))
      if (select === undefined || ![...select.options].some(option => option.value === 'deepseek')) return
      select.value = 'deepseek'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const picker = select.parentElement?.querySelector(':scope > .dsh-provider-picker')
      if (picker !== null && picker !== undefined) paintProviderPicker(picker, select.value)
    }))
  })
  const probe = (): void => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[class*="_sandboxAction"]')) {
      if (button.textContent === '临时解锁（不安全）') button.textContent = '临时解锁'
      if (button.textContent === 'Temporarily disable (unsafe)') button.textContent = 'Temporarily disable'
    }
    injectKeyHelp()
    foldExtraSettings()
    injectPetSetting()
    polishSettingsNavigation()
    polishSessionManager()
    enhanceProviderOptions()
    // The block belongs to the general tab's panel only. React does not always
    // replace that panel on a tab switch, so an injection that is never
    // withdrawn leaks the card onto another tab (where it reads as a misplaced
    // official row). Withdraw it whenever its seat is no longer showing.
    const panel = generalPanel()
    const existing = document.getElementById(ENHANCE_ID)
    const existingUpdate = document.getElementById(UPDATE_ID)
    if (panel === null || (existing !== null && existing.parentElement !== panel)) existing?.remove()
    if (panel === null || (existingUpdate !== null && existingUpdate.parentElement !== panel)) existingUpdate?.remove()
    if (panel !== null) {
      injectEnhance(panel)
      injectUpdate(panel)
      const card = document.getElementById(UPDATE_ID)
      if (card !== null) refreshUpdateLanguage(card, currentEnglish())
    }
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
  ipcRenderer.on('desktop:update:changed', (_event, state: UpdateState) => {
    paintUpdateCard(state, currentEnglish())
  })
  probe()
}

/** The card's language, resolved from the official setting at the moment of the call. */
function currentEnglish(): boolean {
  return !isChineseGeneralTab()
}

function isChineseGeneralTab(): boolean {
  const dialog = findSettingsDialog()
  if (dialog === null) return true
  return isGeneralTab(dialog) && !/General/i.test(dialog.querySelector('[class*="navList"]')?.querySelector('[class*="active"]')?.textContent ?? '')
}

injectPetVisibilityGuard()

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectInterfacePolish()
    watchPageTheme()
    watchSettingsDialog()
  }, { once: true })
} else {
  injectInterfacePolish()
  watchPageTheme()
  watchSettingsDialog()
}
