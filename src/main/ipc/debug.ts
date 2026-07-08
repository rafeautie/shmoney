import { ipcMain, safeStorage } from 'electron'
import { asc } from 'drizzle-orm'
import { db } from '../db'
import { connections } from '../db/schema'
import { fetchAccounts } from '../simplefin'
import { IPC } from '@shared/ipc'

// Developer diagnostics only. index.ts registers this handler exclusively when
// is.dev, so the raw-passthrough capability never exists in a production build.
// It returns the SimpleFIN /accounts payload verbatim — no transform, no persist —
// so the Debug page can show exactly what the bridge sends. The access URL itself
// is decrypted here but never leaves the main process.
const DEBUG_FETCH_WINDOW_SECONDS = 90 * 24 * 60 * 60

export function registerDebugIpc(): void {
  ipcMain.handle(IPC.debugRawAccounts, () => {
    const row = db.select().from(connections).orderBy(asc(connections.id)).limit(1).get()
    if (!row) throw new Error('Not connected to SimpleFIN')
    const accessUrl = safeStorage.decryptString(Buffer.from(row.accessUrlEncrypted, 'base64'))
    const startDate = Math.floor(Date.now() / 1000) - DEBUG_FETCH_WINDOW_SECONDS
    return fetchAccounts(accessUrl, startDate)
  })
}
