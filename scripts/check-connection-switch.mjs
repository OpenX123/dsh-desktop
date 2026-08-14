/**
 * Connection-mode integration check: legacy remote settings remain active,
 * then the shortcut toggles to Smart local mode and back without losing the
 * saved remote origin.
 */

import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const checkHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-connection-'))
const desktopHome = join(checkHome, 'desktop')
mkdirSync(desktopHome, { recursive: true })

const remoteServer = createServer((req, res) => {
  if (req.url === '/api/host.describe' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ result: { ok: true } }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><html><head><title>Remote Harness Fixture</title></head><body>'
    + '<div role="dialog"><div class="content"><div class="navList"><button class="active">通用设置</button></div>'
    + '<div class="options"><div><p>fixture setting</p></div></div></div></div></body></html>')
})
await new Promise((resolve, reject) => {
  remoteServer.once('error', reject)
  remoteServer.listen(0, '127.0.0.1', resolve)
})
const address = remoteServer.address()
if (typeof address !== 'object' || address === null) throw new Error('fixture server did not bind')
const remoteOrigin = 'http://127.0.0.1:' + String(address.port)

// Legacy documents had only serverUrl. They must still boot in Connect mode.
writeFileSync(join(desktopHome, 'settings.json'), JSON.stringify({ serverUrl: remoteOrigin }, null, 2) + '\n')

const electronEnv = { ...process.env }
Reflect.deleteProperty(electronEnv, 'ELECTRON_RUN_AS_NODE')
electronEnv.DSH_HOME = join(checkHome, 'dsh')
electronEnv.DSH_DESKTOP_HOME = desktopHome
electronEnv.DSH_DESKTOP_SKIP_PROBE = '1'

let app
try {
  app = await electron.launch({
    args: [join(APP_DIR, '.build', 'main.mjs'), '--user-data-dir=' + join(checkHome, 'chromium')],
    env: electronEnv,
  })
  let window = await app.firstWindow()
  await window.waitForFunction(() => document.title === 'Remote Harness Fixture', { timeout: 10_000 })
  const legacyStatus = await window.evaluate(() => window.desktop.connection.getStatus())
  if (legacyStatus.selectedMode !== 'connect' || legacyStatus.savedServerUrl !== remoteOrigin || !legacyStatus.canSwitch) {
    throw new Error('legacy remote settings were not exposed as switchable Connect mode: ' + JSON.stringify(legacyStatus))
  }
  await window.locator('#dsh-desktop-enhance').waitFor({ state: 'visible', timeout: 3_000 })
  if (await window.locator('#dsh-enhance-switch').textContent() !== '切换到本地'
    || await window.locator('#dsh-enhance-url').inputValue() !== remoteOrigin) {
    throw new Error('enhanced connection card did not expose the saved remote shortcut')
  }
  const remoteSettingsPagePromise = app.waitForEvent('window')
  await window.evaluate(() => { window.desktop.openConnectionSettings() })
  const remoteSettingsPage = await remoteSettingsPagePromise
  await remoteSettingsPage.waitForFunction(() => document.querySelector('#switch')?.hidden === false)
  if (await remoteSettingsPage.locator('#switch').textContent() !== '切换到本地') {
    throw new Error('remote shortcut did not offer local mode')
  }
  await remoteSettingsPage.close()

  const toSmart = await window.evaluate(() => window.desktop.connection.switchMode())
  if (!toSmart.switched || toSmart.mode !== 'smart') throw new Error('failed to switch to Smart mode: ' + JSON.stringify(toSmart))
  window = app.windows()[0]
  await window.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 60_000 })
  const smartSettings = JSON.parse(readFileSync(join(desktopHome, 'settings.json'), 'utf8'))
  if (smartSettings.serverUrl !== remoteOrigin || smartSettings.connectionMode !== 'smart') {
    throw new Error('Smart switch did not preserve the remote origin: ' + JSON.stringify(smartSettings))
  }
  const smartSettingsPagePromise = app.waitForEvent('window')
  await window.evaluate(() => { window.desktop.openConnectionSettings() })
  const smartSettingsPage = await smartSettingsPagePromise
  await smartSettingsPage.waitForFunction(() => document.querySelector('#switch')?.hidden === false)
  if (await smartSettingsPage.locator('#switch').textContent() !== '切换到远程'
    || await smartSettingsPage.locator('#url').inputValue() !== remoteOrigin) {
    throw new Error('Smart shortcut did not retain the saved remote target')
  }
  await smartSettingsPage.close()

  const toRemote = await window.evaluate(() => window.desktop.connection.switchMode())
  if (!toRemote.switched || toRemote.mode !== 'connect') throw new Error('failed to switch back to Connect mode: ' + JSON.stringify(toRemote))
  await window.waitForFunction(() => document.title === 'Remote Harness Fixture', { timeout: 10_000 })
  const remoteSettings = JSON.parse(readFileSync(join(desktopHome, 'settings.json'), 'utf8'))
  if (remoteSettings.serverUrl !== remoteOrigin || remoteSettings.connectionMode !== 'connect') {
    throw new Error('Connect switch was not persisted: ' + JSON.stringify(remoteSettings))
  }

  console.log('✓ legacy remote configuration remains active')
  console.log('✓ enhanced connection card shows the saved remote shortcut')
  console.log('✓ native settings shows the context-aware shortcut')
  console.log('✓ shortcut switches to Smart mode without deleting the remote address')
  console.log('✓ shortcut switches back to the saved remote origin')
} finally {
  await app?.close().catch(() => {})
  await new Promise(resolve => remoteServer.close(resolve))
  rmSync(checkHome, { recursive: true, force: true })
}
