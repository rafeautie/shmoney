import { IPC } from '@shared/ipc'
import { transactionsExportQuerySchema } from '@shared/transaction-filters'
import { transactionsCsv } from '../main/export'
import { filteredWhere, transactionRows } from '../main/ipc/transactions-page'
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

  // backups and full exports need the desktop app's database file; the
  // Storage section hides them in the demo
  ipcMain.handle(STORAGE_IPC.listBackups, () => [])
  ipcMain.handle(STORAGE_IPC.showInFolder, () => {})

  // the browser's own download stands in for the save dialog
  ipcMain.handle(IPC.transactionsExportCsv, (_event, input) => {
    const q = transactionsExportQuerySchema.parse(input)
    const csv = transactionsCsv(
      transactionRows(filteredWhere(q.filters, q.accountId), q.sortBy, q.sortDir)
    )
    const name = `shmoney transactions ${new Date().toLocaleDateString('en-CA')}.csv`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = name
    link.click()
    URL.revokeObjectURL(link.href)
    return name
  })
}
