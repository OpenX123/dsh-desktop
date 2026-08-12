/**
 * Visual verification driver: launch the built desktop client under
 * Playwright's Electron support and capture screenshots of the official Web
 * UI running in the client window. Usage: node scripts/shot.mjs [outdir]
 * @module desktop/scripts/shot
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const outDir = process.argv[2] ?? join(APP_DIR, 'shots')
mkdirSync(outDir, { recursive: true })

const shot = async (page, name) => {
  const path = join(outDir, name + '.png')
  await page.screenshot({ path })
  console.log('saved ' + path)
}

const app = await electron.launch({ args: [join(APP_DIR, '.build', 'main.mjs')] })
const window = await app.firstWindow()
// The local dsh web child boots first; the official Web UI appears in the
// window once the carrier reaches it.
await window.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 60000 })
await window.waitForTimeout(3000)
await shot(window, '01-empty-state')

// Open the official settings surface (sidebar footer).
const settings = window.getByRole('button', { name: '设置' }).first()
await settings.click()
await window.waitForTimeout(600)
await shot(window, '02-settings')
await window.keyboard.press('Escape')
await window.waitForTimeout(300)

// Type into the composer.
await window.locator('textarea').first().click()
await window.keyboard.type('你好，介绍一下你自己', { delay: 12 })
await window.waitForTimeout(300)
await shot(window, '03-composer-draft')

await app.close()
console.log('done')
