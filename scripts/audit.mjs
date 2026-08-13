/**
 * Interface boot smoke: the client window must show the official Web UI —
 * boot manifest present, the official sidebar and composer rendered, and no
 * page errors. This replaces the custom-renderer design audit, which no
 * longer applies (the interface is the official product's).
 * Usage: node scripts/audit.mjs
 * @module desktop/scripts/audit
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const desktopVersion = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version
const dshVersion = JSON.parse(readFileSync(join(APP_DIR, 'dsh-runtime', 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh']
const electronEnv = { ...process.env }
Reflect.deleteProperty(electronEnv, 'ELECTRON_RUN_AS_NODE')

const app = await electron.launch({ args: [join(APP_DIR, '.build', 'main.mjs')], env: electronEnv })
const window = await app.firstWindow()
const pageErrors = []
window.on('pageerror', err => { pageErrors.push(err.message) })

await window.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 60000 })
await window.waitForTimeout(3000)

// A fresh DSH_HOME opens the official onboarding overlay. Advance it before
// testing controls underneath so this smoke represents a real first install.
for (let step = 0; step < 8; step += 1) {
  const onboarding = window.locator('[class*="onboardingOverlay"]').last()
  if (!await onboarding.isVisible().catch(() => false)) break
  const buttons = onboarding.getByRole('button')
  const count = await buttons.count()
  if (count === 0) break
  await buttons.nth(count - 1).click()
  await window.waitForTimeout(500)
}
await window.waitForFunction(() => document.querySelector('[class*="onboardingOverlay"]') === null, { timeout: 30000 })
// Completing onboarding may open a second guided modal. Follow its primary
// action just as a first-time user would, then dismiss any optional dialog.
for (let step = 0; step < 8; step += 1) {
  const mask = window.locator('div[aria-hidden="true"][class*="_mask_"]').last()
  if (!await mask.isVisible().catch(() => false)) break
  const modal = window.locator('[role="presentation"]').filter({ visible: true }).last()
  const buttons = modal.locator('button:not([disabled])').filter({ visible: true })
  const count = await buttons.count()
  if (count > 0) {
    await buttons.nth(count - 1).click()
  } else {
    await window.keyboard.press('Escape')
  }
  await window.waitForTimeout(500)
}

const checks = []
const check = (name, ok, detail) => checks.push({ ok, name, detail })

const title = await window.title()
check('official web ui title', /deepseek harness/i.test(title), title)
const bootManifestType = await window.evaluate(() => typeof window.__DSH_BOOT__)
check('boot manifest injected', bootManifestType === 'object', bootManifestType)
check('sidebar rendered', await window.getByRole('button', { name: /设置|Settings/ }).first().isVisible().catch(() => false), 'Settings button')
check('composer rendered', await window.locator('textarea').first().isVisible().catch(() => false), 'textarea')
check('session list seat', (await window.getByRole('button', { name: /新建会话|New Session/i }).count()) > 0, 'New Session button')

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
await settingsPage.waitForFunction(() => document.querySelector('#status')?.textContent !== '读取状态…')
const settingsUrl = new URL(settingsPage.url())
check('private settings path', settingsUrl.pathname.length >= 49, settingsUrl.pathname)
check('settings script executed', settingsErrors.length === 0, settingsErrors.join('; '))
const versionText = await settingsPage.locator('#versions').textContent() ?? ''
check('independent version display', versionText.includes('桌面客户端 v' + desktopVersion) && versionText.includes('内置 dsh ' + dshVersion), versionText)
const publicSettingsResponse = await fetch(settingsUrl.origin + '/desktop/settings')
check('public settings path rejected', publicSettingsResponse.status === 404, String(publicSettingsResponse.status))
await settingsPage.close()

// The release runtime uses the stock published Web UI. Its Settings dialog
// must remain operable; desktop connection controls live in the native page
// verified above rather than in a source-checkout-only DOM patch.
await window.getByRole('button', { name: /设置|Settings/ }).first().click()
const settingsDialogVisible = await window.locator('[role="presentation"]').filter({ visible: true }).last().waitFor({ state: 'visible', timeout: 3000 })
  .then(() => true, () => false)
check('official settings dialog', settingsDialogVisible, '[role="presentation"]')
const enhancedCardVisible = await window.locator('#dsh-desktop-enhance').waitFor({ state: 'visible', timeout: 3000 })
  .then(() => true, () => false)
check('desktop connection card', enhancedCardVisible, '#dsh-desktop-enhance')
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
