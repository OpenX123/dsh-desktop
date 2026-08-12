/**
 * End-to-end smoke: boot the client, save the API key through the settings
 * panel, send a real prompt, and verify the streamed assistant reply lands.
 * The key is read from ~/.dsh/.env (this machine's existing config) and is
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
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path })
  console.log(`saved ${path}`)
}

// Read the key from the machine's existing harness home (never printed).
const homeEnv = join(homedir(), '.dsh', '.env')
let apiKey = process.env.DEEPSEEK_API_KEY ?? ''
if (apiKey === '' && existsSync(homeEnv)) {
  const text = readFileSync(homeEnv, 'utf8')
  const match = /^DEEPSEEK_API_KEY=(.+)$/m.exec(text)
  if (match !== null) apiKey = match[1].trim()
}
if (apiKey === '') {
  console.log('no API key available; skipping live prompt')
  process.exit(0)
}

const app = await electron.launch({ args: [join(APP_DIR, '.build', 'main.mjs')] })
const window = await app.firstWindow()
window.on('console', msg => console.log(`[renderer:${msg.type()}] ${msg.text().slice(0, 300)}`))
window.on('pageerror', err => console.log(`[pageerror] ${err.message.slice(0, 500)}\n${(err.stack ?? '').split('\n').slice(0, 6).join('\n')}`))
await window.waitForSelector('.sidebar', { timeout: 60000 })
await window.waitForTimeout(2500)

// Save the key through the settings panel (the client's own credential store).
await window.click('button[aria-label="设置"]')
await window.waitForTimeout(300)
await window.fill('.key-input', apiKey)
await window.click('.key-row .ghost-btn')
await window.waitForSelector('.modal-note.ok', { timeout: 5000 }).catch(() => {})
await shot(window, '10-settings-saved')
await window.click('button[aria-label="关闭"]')
await window.waitForTimeout(300)

// Type a prompt and send it.
await window.click('.composer-input')
await window.keyboard.type('请只回复两个字：收到', { delay: 8 })
await window.waitForTimeout(300)
await shot(window, '11-ready-to-send')
await window.click('.send-btn')
await window.waitForTimeout(800)
await shot(window, '12-running')

// Wait for the assistant reply to settle (streaming → committed message).
let replied = false
for (let i = 0; i < 60; i += 1) {
  await window.waitForTimeout(1000)
  const count = await window.$$eval('.msg.assistant', els => els.length)
  const running = await window.$eval('.send-btn', el => el.classList.contains('stop')).catch(() => false)
  if (count >= 1 && !running) {
    replied = true
    break
  }
}
await shot(window, '13-reply')
const text = await window.$eval('.msg.assistant', el => el.textContent).catch(() => '')
console.log(`assistant replied: ${replied} — "${text.slice(0, 120)}"`)

await app.close()
process.exit(replied ? 0 : 1)
