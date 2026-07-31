import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'

// the same set electron-builder claims in fileAssociations, minus csv/tsv:
// claiming those would take the extension away from the user's spreadsheet app
const STATEMENT_EXTENSIONS = /\.(ofx|qfx|qif)$/i

/**
 * The statement file an "open with" launch put on the command line. Windows and
 * Linux pass it in argv; the position varies with how the app was packaged, so
 * match on the extension rather than an index.
 */
export function statementPathFrom(argv: string[]): string | undefined {
  return argv.find((arg) => STATEMENT_EXTENSIONS.test(arg) && existsSync(arg))
}

/**
 * Hand a file the OS opened straight to the renderer's import flow. Sent as
 * bytes so it lands on exactly the path a drag-and-dropped file takes, rather
 * than needing a second read back through the import IPC.
 */
export function sendImportFile(window: BrowserWindow, filePath: string): void {
  window.webContents.send(IPC.appOpenImportFile, {
    fileName: basename(filePath),
    bytes: readFileSync(filePath)
  })
}
