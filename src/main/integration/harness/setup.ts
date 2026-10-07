import { afterAll, afterEach, inject, vi } from 'vitest'

// Tier A: the main process's real IPC handlers and the real preload, over the
// web demo's in-memory sql.js database with every migration applied. Only the
// edges are swapped: Electron for the demo's in-process shim, the access-URL
// keychain and the on-device model for scriptable fakes. Specs drive the app
// through `api` (window.api), exactly as the renderer does.
vi.mock('electron', () => import('../../../demo/shims/electron'))
vi.mock('@electron-toolkit/utils', () => import('../../../demo/shims/toolkit-utils'))
vi.mock('../../db', () => import('./db-module'))
vi.mock('../../logging', () => import('../../../demo/shims/logging'))
vi.mock('../../access-url', () => import('./fakes/access-url'))
vi.mock('../../llm/manager', () => import('./fakes/llm'))

const { runMigrations } = await import('../../../demo/db')
const { recordChannels, writeChannelLog } = await import('./coverage')
const { assertInvariants } = await import('./db')
const { resetFakeLlm } = await import('./fakes/llm')
const { resetFakeAccessUrl } = await import('./fakes/access-url')

runMigrations()
await recordChannels()

const modules = await Promise.all([
  import('../../ipc/connections'),
  import('../../ipc/categories'),
  import('../../ipc/transactions'),
  import('../../ipc/action-log'),
  import('../../ipc/reports'),
  import('../../ipc/budgets'),
  import('../../ipc/goals'),
  import('../../ipc/saved-filters'),
  import('../../ipc/rules'),
  import('../../ipc/rule-suggestions'),
  import('../../ipc/settings'),
  import('../../ipc/storage'),
  import('../../ipc/import'),
  import('../../ipc/app'),
  import('../../ipc/llm'),
  import('../../ipc/chat'),
  import('../../ipc/log'),
  import('../../ipc/demo')
])
for (const mod of modules) {
  for (const [name, value] of Object.entries(mod)) {
    if (/^register\w+Ipc$/.test(name) && typeof value === 'function') value()
  }
}

// the preload hands its api to contextBridge, which the shim parks on `window`;
// the shim's window asks `document` whether it has focus (OS notifications do)
Object.assign(globalThis, { window: globalThis, document: { hasFocus: () => false } })
await import('../../../preload')

afterEach(() => {
  assertInvariants()
  vi.unstubAllGlobals()
  resetFakeLlm()
  resetFakeAccessUrl()
})

afterAll(() => writeChannelLog(inject('channelLogDir')))
