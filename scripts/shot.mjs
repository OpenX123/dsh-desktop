/**
 * Visual verification driver: launch the built desktop client under
 * Playwright's Electron support, run a scenario, and capture screenshots for
 * design iteration. Usage: node scripts/shot.mjs [scenario] [outdir]
 * @module desktop/scripts/shot
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const outDir = process.argv[3] ?? join(APP_DIR, 'shots')
mkdirSync(outDir, { recursive: true })

const shot = async (page, name) => {
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path })
  console.log(`saved ${path}`)
}

const app = await electron.launch({
  args: [join(APP_DIR, '.build', 'main.mjs')],
  env: { ...process.env },
})
const window = await app.firstWindow()
// The harness child boots its own composition first; the renderer appears
// once the carrier is ready.
await window.waitForSelector('.sidebar', { timeout: 60000 })
// Give streams/catalogs a moment to settle.
await window.waitForTimeout(2500)

await shot(window, '01-empty-state')

// Open the settings modal.
await window.click('button[aria-label="设置"]')
await window.waitForTimeout(400)
await shot(window, '02-settings')
await window.click('button[aria-label="关闭"]')
await window.waitForTimeout(300)

// Type into the composer.
await window.click('.composer-input')
await window.keyboard.type('你好，介绍一下你自己', { delay: 12 })
await window.waitForTimeout(300)
await shot(window, '03-composer-draft')

// Open the model picker.
await window.click('.composer-right .composer-select')
await window.waitForTimeout(400)
await shot(window, '04-model-menu')
await window.keyboard.press('Escape')
await window.waitForTimeout(200)

await app.close()
console.log('done')
