/**
 * Interface boot smoke: the client window must show the official Web UI —
 * boot manifest present, the official sidebar and composer rendered, and no
 * page errors. This replaces the custom-renderer design audit, which no
 * longer applies (the interface is the official product's).
 * Usage: node scripts/audit.mjs
 * @module desktop/scripts/audit
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))

const app = await electron.launch({ args: [join(APP_DIR, '.build', 'main.mjs')] })
const window = await app.firstWindow()
const pageErrors = []
window.on('pageerror', err => { pageErrors.push(err.message) })

await window.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 60000 })
await window.waitForTimeout(3000)

const checks = []
const check = (name, ok, detail) => checks.push({ ok, name, detail })

const title = await window.title()
check('official web ui title', /deepseek harness/i.test(title), title)
check('boot manifest injected', await window.evaluate(() => typeof window.__DSH_BOOT__ === 'object'), String(typeof window.__DSH_BOOT__))
check('sidebar rendered', await window.getByRole('button', { name: '设置' }).first().isVisible().catch(() => false), '设置 button')
check('composer rendered', await window.locator('textarea').first().isVisible().catch(() => false), 'textarea')
check('session list seat', (await window.getByRole('button', { name: '新建会话' }).count()) > 0, '新建会话 button')

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
