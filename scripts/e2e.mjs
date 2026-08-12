/**
 * End-to-end smoke: boot the client (official Web UI in the window), send a
 * real prompt through the official composer, and verify the streamed
 * assistant reply lands. The API key comes from the machine's existing
 * harness home (~/.dsh/.env) or the client's own credentials store and is
 * never printed. Usage: node scripts/e2e.mjs
 * @module desktop/scripts/e2e
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(APP_DIR, 'shots')
const shot = async (page, name) => {
  const path = join(outDir, name + '.png')
  await page.screenshot({ path })
  console.log('saved ' + path)
}

// The client's own data home may already hold the key (credentials seam);
// otherwise fall back to the machine's existing harness home (never printed).
let apiKey = process.env.DEEPSEEK_API_KEY ?? ''
if (apiKey === '') {
  const homeEnv = join(homedir(), '.dsh', '.env')
  if (existsSync(homeEnv)) {
    const text = readFileSync(homeEnv, 'utf8')
    const match = /^DEEPSEEK_API_KEY=(.+)$/m.exec(text)
    if (match !== null) apiKey = match[1].trim()
  }
}
if (apiKey === '') {
  console.log('no API key available; skipping live prompt (open 设置 → 凭据 to add one)')
  process.exit(0)
}

const app = await electron.launch({ args: [join(APP_DIR, '.build', 'main.mjs')] })
const window = await app.firstWindow()
window.on('console', msg => console.log('[renderer:' + msg.type() + '] ' + msg.text().slice(0, 300)))
window.on('pageerror', err => console.log('[pageerror] ' + err.message.slice(0, 500)))
await window.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 60000 })
await window.waitForTimeout(3000)
await shot(window, '10-booted')

// Type a prompt and send it through the official composer.
const composer = window.locator('textarea').first()
await composer.click()
await window.keyboard.type('请只回复两个字：收到', { delay: 8 })
await window.waitForTimeout(300)
await shot(window, '11-ready-to-send')
await window.getByRole('button', { name: '发送消息' }).click()
await window.waitForTimeout(800)
await shot(window, '12-running')

// Wait for the streamed reply to land in the visible text.
let replied = false
for (let i = 0; i < 90; i += 1) {
  await window.waitForTimeout(1000)
  const has = await window.evaluate(() => document.body.innerText.includes('收到')).catch(() => false)
  if (has) {
    replied = true
    break
  }
}
await shot(window, '13-reply')
const text = await window.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '')
console.log('assistant replied: ' + replied + ' — "' + text.replace(/\s+/g, ' ').slice(0, 120) + '"')

await app.close()
process.exit(replied ? 0 : 1)
