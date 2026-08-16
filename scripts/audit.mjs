/**
 * Interface boot smoke: the client window must show the official Web UI —
 * boot manifest present, the official sidebar and composer rendered, and no
 * page errors. This replaces the custom-renderer design audit, which no
 * longer applies (the interface is the official product's).
 *
 * Before anything launches, the client's identity fingerprint is asserted
 * (see check-identity.mjs for what that guards against): a mismatch fails
 * here, in seconds, instead of after the UI walk.
 * Usage: node scripts/audit.mjs
 * @module desktop/scripts/audit
 */

import { readFileSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { assertClientIdentity } from './check-identity.mjs'

// Identity fingerprint guard — see the module comment above. Runs before the
// version is read: an overwritten manifest has a version too, and reporting it
// as a stale audit result would hide the real accident.
assertClientIdentity()

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const desktopVersion = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version
const dshVersion = JSON.parse(readFileSync(join(APP_DIR, 'dsh-runtime', 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh']

const auditHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-audit-'))
process.on('exit', () => { rmSync(auditHome, { recursive: true, force: true }) })
const electronEnv = { ...process.env }
Reflect.deleteProperty(electronEnv, 'ELECTRON_RUN_AS_NODE')
electronEnv.DSH_HOME = join(auditHome, 'dsh')
electronEnv.DSH_DESKTOP_HOME = join(auditHome, 'desktop')
electronEnv.DSH_DESKTOP_SKIP_PROBE = '1'
// Audit the runtime the release ships, not whichever dsh this developer
// happens to have installed — the client prefers an installed one at runtime.
electronEnv.DSH_DESKTOP_SKIP_INSTALLED_DSH = '1'

const app = await electron.launch({
  args: [join(APP_DIR, '.build', 'main.mjs'), '--user-data-dir=' + join(auditHome, 'chromium')],
  env: electronEnv,
})
const window = await app.firstWindow()
const pageErrors = []
window.on('pageerror', err => { pageErrors.push(err.message) })
const checks = []
const check = (name, ok, detail) => checks.push({ ok, name, detail })

const DEEPSEEK_KEY_URL = 'https://platform.deepseek.com/api_keys'
/** Assert exactly one key-help link, pointing at the platform page. */
const checkKeyHelpLink = async (name, locator) => {
  const count = await locator.count()
  const href = count === 1 ? await locator.first().getAttribute('href') : null
  check(name, href === DEEPSEEK_KEY_URL, href ?? 'count=' + String(count))
}

// The app must paint before the local runtime is ready, otherwise a Finder or
// Dock launch appears to do nothing for several seconds.
const loadingVisible = await window.locator('#loading-status').waitFor({ state: 'visible', timeout: 3000 })
  .then(() => true, () => false)
check('startup loading window', loadingVisible, '#loading-status')

await window.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 60000 })
await window.waitForTimeout(1500)
check('desktop preload bridge survives web navigation',
  await window.evaluate(() => typeof window.desktop === 'object'), 'window.desktop')

// A clean profile first shows the official notice, then the DeepSeek key
// prompt. Verify our help at the moment a new user needs it and choose the
// supported "later" path without storing a credential.
let keyPromptReached = false
for (let step = 0; step < 8; step += 1) {
  const dialog = window.locator('[role="dialog"]:visible').last()
  if (!await dialog.isVisible().catch(() => false)) break
  const keyInput = dialog.locator('input[type="password"]')
  if (await keyInput.count() > 0) {
    keyPromptReached = true
    await checkKeyHelpLink('first-run DeepSeek key link', dialog.locator('.dsh-desktop-key-help a'))
    const later = dialog.getByRole('button', { name: /稍后配置|Configure later/i })
    if (await later.count() > 0) await later.click()
    break
  }
  const next = dialog.getByRole('button', { name: /继续|Continue/i })
  if (await next.count() === 0) break
  await next.click()
  await window.waitForTimeout(500)
}
// Without this the walk above can stop early — an onboarding relabel, say —
// and silently take its assertion with it, leaving the audit green.
check('first-run key prompt reached', keyPromptReached, 'onboarding walked to the DeepSeek key step')

const title = await window.title()
check('official web ui title', /deepseek harness/i.test(title), title)
const bootManifestType = await window.evaluate(() => typeof window.__DSH_BOOT__)
check('boot manifest injected', bootManifestType === 'object', bootManifestType)
check('sidebar rendered', await window.getByRole('button', { name: /设置|Settings/ }).first().isVisible().catch(() => false), 'Settings button')
check('composer rendered', await window.locator('textarea').first().isVisible().catch(() => false), 'textarea')
check('session list seat', (await window.getByRole('button', { name: /新建会话|New Session/i }).count()) > 0, 'New Session button')
const interfacePolish = window.locator('#dsh-desktop-interface-polish')
check('workbench polish stylesheet', await interfacePolish.count() === 1, '#dsh-desktop-interface-polish')
const workbenchPolish = await window.evaluate(() => {
  const fixture = document.createElement('div')
  fixture.style.cssText = 'position:fixed;left:-9999px'
  fixture.innerHTML = '<div class="audit_pane"><div class="audit_tabBar"><div class="audit_tabList">'
    + '<div class="audit_tab audit_tabActive" draggable="true"></div></div></div></div>'
  document.body.append(fixture)
  const bar = getComputedStyle(fixture.querySelector('.audit_tabBar'))
  const tab = getComputedStyle(fixture.querySelector('.audit_tab'))
  const result = { barHeight: bar.height, tabHeight: tab.height, radius: tab.borderRadius, shadow: tab.boxShadow }
  fixture.remove()
  return result
})
check('workbench tabs use soft inset geometry', workbenchPolish.barHeight === '40px'
  && workbenchPolish.tabHeight === '28px' && workbenchPolish.radius === '8px'
  && workbenchPolish.shadow !== 'none', JSON.stringify(workbenchPolish))

// The native connection page is security-sensitive and previously regressed
// when its CSP blocked its own script. Verify that it is live behind an
// unguessable path and that the same loopback origin rejects the public path.
const settingsPagePromise = app.waitForEvent('window')
await window.evaluate(() => { window.desktop.openConnectionSettings() })
const settingsPage = await settingsPagePromise
const settingsErrors = []
settingsPage.on('console', message => {
  if (message.type() === 'error') settingsErrors.push(message.text())
})
await settingsPage.waitForFunction(() => (document.querySelector('#versions')?.textContent ?? '').includes('桌面客户端 v'))
const settingsUrl = new URL(settingsPage.url())
check('private settings path', settingsUrl.pathname.length >= 49, settingsUrl.pathname)
check('settings script executed', settingsErrors.length === 0, settingsErrors.join('; '))
const versionText = await settingsPage.locator('#versions').textContent() ?? ''
check('independent version display', versionText.includes('桌面客户端 v' + desktopVersion) && versionText.includes('内置 dsh ' + dshVersion), versionText)
const publicSettingsResponse = await fetch(settingsUrl.origin + '/desktop/settings')
check('public settings path rejected', publicSettingsResponse.status === 404, String(publicSettingsResponse.status))
// DNS rebinding: a name that resolves to 127.0.0.1 reaches this server under
// the attacker's origin. The private path is the real gate, but the Host check
// means a rebound request never gets as far as needing it.
// Raw http.request, not fetch: fetch owns the Host header and would send the
// real authority no matter what this asked for.
const rebindStatus = await new Promise((resolve, reject) => {
  const req = httpRequest({
    host: '127.0.0.1',
    port: Number(settingsUrl.port),
    path: settingsUrl.pathname + 'desktop/status',
    headers: { host: 'rebind.example' },
  }, res => { res.resume(); resolve(res.statusCode) })
  req.once('error', reject)
  req.end()
})
check('foreign Host header rejected', rebindStatus === 403, String(rebindStatus))
const nosniff = publicSettingsResponse.headers.get('x-content-type-options')
check('settings server sends nosniff', nosniff === 'nosniff', String(nosniff))
await settingsPage.close()

// The official settings dialog remains operable around both append-only
// enhancements. Verify positive and negative seats across real tab switches.
await window.getByRole('button', { name: /设置|Settings/ }).first().click()
const settingsDialog = window.locator('[role="dialog"]:visible').last()
const settingsDialogVisible = await settingsDialog.waitFor({ state: 'visible', timeout: 3000 })
  .then(() => true, () => false)
check('official settings dialog', settingsDialogVisible, '[role="presentation"]')
const enhancedCardVisible = await settingsDialog.locator('#dsh-desktop-enhance').waitFor({ state: 'visible', timeout: 3000 })
  .then(() => true, () => false)
check('desktop connection card', enhancedCardVisible, '#dsh-desktop-enhance')
const updateCardVisible = await settingsDialog.locator('#dsh-desktop-update').waitFor({ state: 'visible', timeout: 3_000 })
  .then(() => true, () => false)
check('desktop update card', updateCardVisible, '#dsh-desktop-update')
check('connection shortcut hidden without a saved remote address',
  await settingsDialog.locator('#dsh-enhance-switch').isHidden(), '#dsh-enhance-switch')

// Optional desktop plugins can add enough settings pages to crowd the nav.
// Clone official rows as a fixture so this stays covered with an empty audit profile.
const foldedLabels = ['自定义提示词', '第三方模型思考强度', 'WSL 后端', '识图插件（view_image）']
const navList = settingsDialog.locator('[class*="navList"]').first()
await navList.evaluate((nav, labels) => {
  const source = nav.querySelector(':scope > button:last-of-type')
  if (source === null) return
  for (const label of labels) {
    const button = source.cloneNode(true)
    button.removeAttribute('aria-current')
    button.dataset.dshMoreFixture = 'true'
    button.querySelector('[class*="navLabel"]').textContent = label
    nav.appendChild(button)
  }
}, foldedLabels)
const moreSettings = settingsDialog.getByRole('button', { name: '更多', exact: true })
await moreSettings.waitFor({ state: 'visible', timeout: 3000 })
const foldedFixtures = navList.locator('[data-dsh-more-fixture="true"]:not(#dsh-desktop-more-settings)')
check('extra settings collapsed', await foldedFixtures.first().isHidden() && await foldedFixtures.count() === 4, '更多')
check('more settings stays before folded settings', await moreSettings.evaluate(button =>
  button.nextElementSibling?.hasAttribute('data-dsh-more-fixture') === true), '更多')
await moreSettings.click()
check('extra settings expand below more', await foldedFixtures.first().isVisible()
  && await moreSettings.isVisible()
  && await moreSettings.getAttribute('aria-expanded') === 'true', '更多')
await moreSettings.click()
check('extra settings collapse again', await foldedFixtures.first().isHidden()
  && await moreSettings.isVisible()
  && await moreSettings.getAttribute('aria-expanded') === 'false', '更多')
await navList.evaluate(nav => {
  nav.querySelector('#dsh-desktop-more-settings')?.remove()
  nav.querySelectorAll('[data-dsh-more-fixture="true"]').forEach(item => { item.remove() })
})

// Exercise the official appearance control, rather than emulating an OS media
// query: the UI owns its theme state and provides the tokens our card consumes.
await settingsDialog.getByRole('button', { name: /深色|Dark/ }).click()
await window.waitForTimeout(200)
const darkThemeTokens = await settingsDialog.locator('#dsh-desktop-enhance').evaluate(card => {
  const cardStyle = getComputedStyle(card)
  const title = card.querySelector('.dsh-enhance-title')
  const input = card.querySelector('.dsh-enhance-input')
  return {
    title: title ? getComputedStyle(title).color : '',
    titleToken: cardStyle.getPropertyValue('--dsw-alias-label-primary').trim(),
    input: input ? getComputedStyle(input).backgroundColor : '',
    inputToken: cardStyle.getPropertyValue('--dsw-alias-bg-layer-1').trim(),
  }
})
check('connection card follows dark theme tokens',
  darkThemeTokens.title !== '' && darkThemeTokens.title === darkThemeTokens.titleToken
    && darkThemeTokens.input !== '' && darkThemeTokens.input === darkThemeTokens.inputToken,
  JSON.stringify(darkThemeTokens))

await settingsDialog.getByRole('button', { name: /模型|Models/ }).click()
await window.waitForTimeout(200)
check('connection card leaves Models tab', await settingsDialog.locator('#dsh-desktop-enhance').count() === 0, 'Models')
check('update card leaves Models tab', await settingsDialog.locator('#dsh-desktop-update').count() === 0, 'Models')
const deepSeekHelp = settingsDialog.locator('.dsh-desktop-key-help a')
await checkKeyHelpLink('DeepSeek settings key link', deepSeekHelp)

await settingsDialog.getByRole('button', { name: /^添加提供方$|^Add provider$/i }).click()
const providerPicker = settingsDialog.locator('.dsh-provider-picker')
await providerPicker.waitFor({ state: 'visible', timeout: 3000 })
const providerSelect = settingsDialog.locator('select[aria-label="提供方"], select[aria-label="Provider"]')
check('new provider defaults to DeepSeek', await providerSelect.inputValue() === 'deepseek', await providerSelect.inputValue())
const providerValues = await providerSelect.locator('option')
  .evaluateAll(options => options.map(option => option.value))
const chineseProviderPrefixes = ['ant-ling', 'deepseek', 'kimi', 'minimax', 'moonshotai', 'qwen', 'xiaomi', 'zai']
const providerOrder = [...providerValues].sort((a, b) => {
  if (a === 'deepseek') return -1
  if (b === 'deepseek') return 1
  const aChinese = chineseProviderPrefixes.some(prefix => a === prefix || a.startsWith(prefix + '-'))
  const bChinese = chineseProviderPrefixes.some(prefix => b === prefix || b.startsWith(prefix + '-'))
  return Number(bChinese) - Number(aChinese) || a.localeCompare(b, 'en')
})
check('provider options put DeepSeek and Chinese services first', providerValues.join('\n') === providerOrder.join('\n'),
  providerValues.join(', '))
const primaryProviders = providerPicker.locator(':scope > .dsh-provider-grid > [data-provider-value]')
const primaryProviderCount = await primaryProviders.count()
check('all Chinese providers have vector logos', primaryProviderCount > 0
  && await primaryProviders.locator('.dsh-provider-logo svg').count() === primaryProviderCount,
  String(primaryProviderCount))
const secondaryProviders = providerPicker.locator('.dsh-provider-more [data-provider-value]')
check('other providers start folded', await secondaryProviders.count() > 0 && await secondaryProviders.first().isHidden(),
  String(await secondaryProviders.count()))
await providerPicker.locator('.dsh-provider-more > summary').click()
check('more providers expand', await secondaryProviders.first().isVisible(), '更多提供方')
await providerPicker.locator('[data-provider-value="ant-ling"]').click()
check('logo card updates the native form value', await providerSelect.inputValue() === 'ant-ling', await providerSelect.inputValue())
await providerPicker.locator('[data-provider-value="deepseek"]').click()
await settingsDialog.getByRole('button', { name: /取消|Cancel/ }).last().click()
await settingsDialog.getByRole('button', { name: /^添加提供方$|^Add provider$/i }).click()
await providerPicker.waitFor({ state: 'visible', timeout: 3000 })
check('reopened provider form defaults to DeepSeek', await providerSelect.inputValue() === 'deepseek',
  await providerSelect.inputValue())
await settingsDialog.getByRole('button', { name: /取消|Cancel/ }).last().click()

await settingsDialog.getByRole('button', { name: /添加自定义提供方|Add a custom provider/i }).click()
await window.waitForTimeout(200)
const customKey = settingsDialog.locator('input[type="password"]').last()
const customHelpCount = await customKey.locator('xpath=..').locator('.dsh-desktop-key-help').count()
check('custom provider has no DeepSeek link', customHelpCount === 0, String(customHelpCount))
const deepSeekHelpCount = await deepSeekHelp.count()
check('custom provider does not duplicate key link', deepSeekHelpCount === 1, String(deepSeekHelpCount))

await settingsDialog.getByRole('button', { name: /通用设置|General(?: Settings)?/ }).click()
await window.waitForTimeout(200)
check('connection card returns to General tab', await settingsDialog.locator('#dsh-desktop-enhance').count() === 1, 'General')
await settingsDialog.getByRole('button', { name: /插件|Plugins/ }).click()
await window.waitForTimeout(200)
check('connection card leaves Plugins tab', await settingsDialog.locator('#dsh-desktop-enhance').count() === 0, 'Plugins')
await window.keyboard.press('Escape')

let failures = 0
for (const c of checks) {
  console.log((c.ok ? '✓' : '✗') + ' ' + c.name + ': ' + c.detail)
  if (!c.ok) failures += 1
}
if (pageErrors.length > 0) {
  failures += pageErrors.length
  for (const message of pageErrors) console.log('✗ pageerror: ' + message.slice(0, 300))
}
console.log(failures === 0 ? '\nAll interface checks passed.' : '\n' + String(failures) + ' interface checks FAILED.')
await app.close()
process.exit(failures === 0 ? 0 : 1)
