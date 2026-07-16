import { ipcMain } from 'electron'
import { createLogger } from '../logging'
import { LOG_IPC, logWriteSchema } from '@shared/diagnostics'

const log = createLogger('renderer')

export function registerLogIpc(): void {
  // .on, not .handle: logging is fire-and-forget and must never block the
  // renderer or reject back into it
  ipcMain.on(LOG_IPC.write, (_event, input: unknown) => {
    const parsed = logWriteSchema.safeParse(input)
    if (!parsed.success) return
    const { level, event, detail } = parsed.data
    if (level === 'error') log.error(event, detail)
    else if (detail !== undefined) log[level](event, { detail })
    else log[level](event)
  })
}
