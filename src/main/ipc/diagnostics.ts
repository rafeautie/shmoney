import { readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { app, clipboard, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { logsDir } from '../logging'
import { DIAGNOSTICS_IPC } from '@shared/diagnostics'

const RECENT_LINES = 100
// pathological ceiling; a normal excerpt is a few KB
const MAX_TEXT_CHARS = 64_000

const copyInputSchema = z.string().max(MAX_TEXT_CHARS)

// the log file is already scrubbed at write time (see logging/index.ts), so
// the excerpt inherits that; nothing here re-reads any user data
function recentLogLines(): string {
  try {
    const text = readFileSync(join(logsDir(), 'main.log'), 'utf8')
    const lines = text.split('\n').filter((l) => l.trim() !== '')
    return lines.slice(-RECENT_LINES).join('\n').slice(-MAX_TEXT_CHARS)
  } catch {
    return '(no log file yet)'
  }
}

/**
 * The plain-text diagnostics block the report-bug dialog previews. Whatever
 * this returns is exactly what the user sees and exactly what gets copied;
 * there is no second, hidden payload.
 */
function buildDiagnostics(): string {
  return [
    `shmoney ${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`,
    `${process.platform} ${os.release()} ${process.arch}`,
    `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    '',
    `--- last ${RECENT_LINES} log lines ---`,
    recentLogLines()
  ].join('\n')
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle(DIAGNOSTICS_IPC.get, () => buildDiagnostics())

  // the renderer passes back the exact text it previewed, so what lands on the
  // clipboard is byte-for-byte what the user reviewed
  ipcMain.handle(DIAGNOSTICS_IPC.copy, (_event, input: unknown) => {
    clipboard.writeText(copyInputSchema.parse(input))
  })

  ipcMain.handle(DIAGNOSTICS_IPC.openLogsFolder, () => {
    return shell.openPath(logsDir())
  })
}
