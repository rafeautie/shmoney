import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TestProject } from 'vitest/node'

// The channel gate: every IPC channel the app declares should be exercised by
// some tier A spec. Each spec file records what it touched; the global teardown
// unions the files and names whatever no spec reached. A run of every spec
// fails on a gap; a filtered run (one spec while iterating) only reports.

declare module 'vitest' {
  export interface ProvidedContext {
    channelLogDir: string
  }
}

const touched = new Set<string>()

/** wraps the demo shim's three directions of traffic: invoke, send, and pushes */
export async function recordChannels(): Promise<void> {
  const { ipcRenderer, BrowserWindow } = await import('../../../demo/shims/electron')
  const invoke = ipcRenderer.invoke
  ipcRenderer.invoke = (channel: string, ...args: unknown[]) => {
    touched.add(channel)
    return invoke(channel, ...args)
  }
  const send = ipcRenderer.send
  ipcRenderer.send = (channel: string, ...args: unknown[]) => {
    touched.add(channel)
    send(channel, ...args)
  }
  const contents = BrowserWindow.getAllWindows()[0].webContents
  const push = contents.send
  contents.send = (channel: string, payload: unknown) => {
    touched.add(channel)
    push(channel, payload)
  }
}

export function writeChannelLog(dir: string): void {
  writeFileSync(join(dir, `${randomUUID()}.json`), JSON.stringify([...touched]))
}

// Channels only the desktop app can serve (real fs, updater, the keychain-backed
// debug fetch) or that only Electron's main process and the real model manager
// push (menu navigation, OS file opens, download progress, usage). Tier C covers
// them; the gate lists them separately.
const ELECTRON_ONLY =
  /^(updates|diagnostics|storage|debug):|^app:(navigate|openImportFile)$|^llm:(downloadProgress|usageChanged)$/

async function declaredChannels(): Promise<string[]> {
  const modules = await Promise.all([
    import('@shared/ipc'),
    import('@shared/budgets'),
    import('@shared/chat'),
    import('@shared/demo'),
    import('@shared/diagnostics'),
    import('@shared/goals'),
    import('@shared/import'),
    import('@shared/llm'),
    import('@shared/reports'),
    import('@shared/rules'),
    import('@shared/rule-suggestions'),
    import('@shared/settings'),
    import('@shared/storage'),
    import('@shared/transaction-filters'),
    import('@shared/updates')
  ])
  const channels = new Set<string>()
  for (const mod of modules) {
    for (const [name, value] of Object.entries(mod)) {
      if (!/^([A-Z_]+_)?IPC$/.test(name) || typeof value !== 'object' || value === null) continue
      for (const channel of Object.values(value)) {
        if (typeof channel === 'string') channels.add(channel)
      }
    }
  }
  return [...channels].sort()
}

export default function setup(project: TestProject): () => Promise<void> {
  const dir = join(tmpdir(), `shmoney-channels-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  project.provide('channelLogDir', dir)

  return async () => {
    const reached = new Set<string>()
    for (const file of readdirSync(dir)) {
      for (const channel of JSON.parse(readFileSync(join(dir, file), 'utf8')) as string[]) {
        reached.add(channel)
      }
    }
    const reports = readdirSync(dir).length
    rmSync(dir, { recursive: true, force: true })
    if (reports === 0) return
    const specs = readdirSync(join(project.config.root, 'src/main/integration')).filter((f) =>
      f.endsWith('.int.test.ts')
    ).length

    const declared = await declaredChannels()
    const missing = declared.filter((c) => !reached.has(c) && !ELECTRON_ONLY.test(c))
    const electronOnly = declared.filter((c) => ELECTRON_ONLY.test(c))
    const covered = declared.length - missing.length - electronOnly.length
    const lines = [
      `IPC channel gate: ${covered}/${declared.length - electronOnly.length} channels exercised` +
        ` (${electronOnly.length} desktop-only, left to tier C)`,
      ...missing.map((c) => `  not exercised: ${c}`)
    ]
    console.log(lines.join('\n'))
    if (missing.length > 0 && reports >= specs) {
      throw new Error(`${missing.length} IPC channels are not exercised by any spec`)
    }
  }
}
