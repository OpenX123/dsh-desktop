/**
 * Desktop client preload: the minimal, fixed surface exposed to the renderer.
 * Runs sandboxed, so only Electron APIs are available (no Node built-ins);
 * the OS username arrives from the main process via an additional argv flag.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge } from 'electron'

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  const arg = process.argv.find(item => item.startsWith(prefix))
  return arg === undefined ? undefined : arg.slice(prefix.length)
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  username: argValue('dsh-username') ?? 'user',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})
