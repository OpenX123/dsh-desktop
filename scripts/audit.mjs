/**
 * Design-contract audit: verify the visual spec quantitatively through
 * computed styles (the model cannot view screenshots, so the audit stands in
 * for the design review). Usage: node scripts/audit.mjs
 * @module desktop/scripts/audit
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))

const app = await electron.launch({ args: [join(APP_DIR, '.build', 'main.mjs')] })
const window = await app.firstWindow()
await window.waitForSelector('.sidebar', { timeout: 60000 })
await window.waitForTimeout(2500)

const checks = []
const check = (name, actual, expected) => {
  const ok = actual === expected
  checks.push({ ok, name, actual, expected })
}

const style = async (selector, prop) => window.$eval(selector, (el, p) => getComputedStyle(el)[p], prop)

// Layout contract
const win = await window.evaluate(() => ({ w: innerWidth, h: innerHeight }))
check('window size', `${win.w}x${win.h}`, '1280x820')

// Sidebar
check('sidebar width', await style('.sidebar', 'width'), '320px')
check('sidebar bg', await style('.sidebar', 'backgroundColor'), 'rgb(247, 247, 245)') // #F7F7F5
check('nav font size', await style('.nav-item', 'fontSize'), '15px')
check('nav height', await style('.nav-item', 'height'), '34px')

// Main / text
check('main bg', await style('.main', 'backgroundColor'), 'rgb(255, 255, 255)')
check('body text color', await style('body', 'color'), 'rgb(36, 36, 36)') // #242424
check('body font size', await style('body', 'fontSize'), '14px')

// Empty state
check('empty title size', await style('.empty-title', 'fontSize'), '31px')
check('empty title weight', await style('.empty-title', 'fontWeight'), '500')
check('empty mark radius', await style('.empty-mark', 'borderRadius'), '26px')
check('empty mark bg', await style('.empty-mark', 'backgroundColor'), 'rgb(244, 244, 242)')

// Composer
check('composer width', await style('.composer', 'width'), '860px')
check('composer radius', await style('.composer', 'borderRadius'), '26px')
check('composer border', await style('.composer', 'borderColor'), 'rgb(231, 231, 228)') // #E7E7E4
check('composer input size', await style('.composer-input', 'fontSize'), '15px')
check('context bar bg', await style('.context-bar', 'backgroundColor'), 'rgb(244, 244, 242)')

// Buttons (send turns black once the composer has text)
await window.click('.composer-input')
await window.keyboard.type('test')
await window.waitForTimeout(200)
check('send size', await style('.send-btn', 'width'), '34px')
check('send bg (enabled)', await style('.send-btn', 'backgroundColor'), 'rgb(28, 28, 28)') // #1C1C1C
check('send radius', await style('.send-btn', 'borderRadius'), '50%')

// Sidebar bottom structure
const footerVisible = await window.$eval('.sidebar-footer', el => {
  const rect = el.getBoundingClientRect()
  return Math.abs(rect.bottom - innerHeight) < 4
})
check('sidebar footer pinned to bottom', String(footerVisible), 'true')

// Composer centered within the main area (sidebar is 320px), near the bottom
const windowSize = await window.evaluate(() => ({ w: innerWidth, h: innerHeight }))
const composerBox = await window.$eval('.composer', el => {
  const rect = el.getBoundingClientRect()
  return { left: rect.left, right: rect.right, bottom: rect.bottom }
})
const mainCenter = 320 + (windowSize.w - 320) / 2
const centered = Math.abs((composerBox.left + composerBox.right) / 2 - mainCenter) < 4
check('composer horizontally centered in main', String(centered), 'true')
check('composer near bottom', String(windowSize.h - composerBox.bottom < 120), 'true')

// Motion contract
const duration = await style('.tree-row', 'transitionDuration')
check('transition duration', duration.split(',')[0].trim(), '0.15s')

let failures = 0
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}: expected ${c.expected}, got ${c.actual}`)
  if (!c.ok) failures += 1
}
console.log(failures === 0 ? '\nAll design checks passed.' : `\n${failures} design checks FAILED.`)
await app.close()
process.exit(failures === 0 ? 0 : 1)
