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

// A clean DSH_HOME opens the official first-run onboarding before the main
// surface. Advance through it so screenshots are reproducible without using
// a developer's existing conversations or settings.
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
// Completing onboarding opens the official model settings. Close that modal
// before capturing the clean home surface; the next scenario opens settings
// again intentionally.
await window.keyboard.press('Escape')
await window.waitForTimeout(800)
await shot(window, '01-empty-state')

// Open the official settings surface (sidebar footer).
const settings = window.getByRole('button', { name: '设置' }).first()
await settings.click()
await window.waitForTimeout(600)
await shot(window, '02-settings')
await window.keyboard.press('Escape')
await window.waitForTimeout(300)

// Type into the composer when the current profile already has a workspace.
// A completely clean profile deliberately keeps the composer disabled until
// the user selects one, so the two privacy-safe screenshots above are enough.
const composer = window.locator('textarea').first()
if (await composer.isEnabled().catch(() => false)) {
  await composer.click()
  await window.keyboard.type('你好，介绍一下你自己', { delay: 12 })
  await window.waitForTimeout(300)
  await shot(window, '03-composer-draft')
} else {
  console.log('skipped 03-composer-draft (no workspace selected)')
}

await app.close()
console.log('done')
