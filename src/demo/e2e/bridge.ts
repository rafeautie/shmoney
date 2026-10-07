import { sql } from 'drizzle-orm'
import { db } from '../db'
import { BrowserWindow } from '../shims/electron'
import type { llmControl } from './llm-manager'

// What a UI spec can reach inside the page, beyond what a user can click: the
// scripted model, raw reads of the stored truth, and main-process pushes that
// only the desktop app would send (menu navigation, OS file opens).

export interface ShmoneyTestBridge {
  llm: typeof llmControl
  sql: (text: string) => Record<string, unknown>[]
  push: (channel: string, payload: unknown) => void
}

declare global {
  interface Window {
    __shmoney: ShmoneyTestBridge
  }
}

export function installBridge(llm: typeof llmControl): void {
  window.__shmoney = {
    llm,
    sql: (text) => db.all(sql.raw(text)),
    push: (channel, payload) => BrowserWindow.getAllWindows()[0].webContents.send(channel, payload)
  }
}
