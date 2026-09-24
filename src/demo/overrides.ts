import { DIAGNOSTICS_IPC } from '@shared/diagnostics'
import type { DatabaseSize } from '@shared/storage'
import { STORAGE_IPC } from '@shared/storage'
import { UPDATES_IPC, type UpdateState } from '@shared/updates'
import { databaseBytes } from './db'
import { DESKTOP_ONLY } from './llm-manager'
import { ipcMain } from './shims/electron'

// The few channels whose real handlers need the OS: the updater, log files and
// the database file on disk. Everything else runs the desktop app's own code.
export function registerOverrides(): void {
  const updates: UpdateState = {
    status: 'disabled',
    version: null,
    progress: null,
    error: null,
    url: null
  }
  ipcMain.handle(UPDATES_IPC.getState, () => updates)
  ipcMain.handle(UPDATES_IPC.check, () => updates)
  ipcMain.handle(UPDATES_IPC.quitAndInstall, () => {})

  ipcMain.handle(DIAGNOSTICS_IPC.get, () => `shmoney web demo ${__APP_VERSION__}\n${DESKTOP_ONLY}`)
  ipcMain.handle(DIAGNOSTICS_IPC.copy, (_event, text) =>
    navigator.clipboard?.writeText(String(text))
  )
  ipcMain.handle(DIAGNOSTICS_IPC.openLogsFolder, () => {})

  ipcMain.handle(STORAGE_IPC.getDatabaseSize, (): DatabaseSize => ({
    totalBytes: databaseBytes(),
    tables: []
  }))
}
