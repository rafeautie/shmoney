import { ipcMain } from 'electron'
import { z } from 'zod'
import { notifyOs } from '../os-shell'
import { setChromeDimmed } from '../chrome-theme'
import { IPC } from '@shared/ipc'

const notifyInputSchema = z.object({ title: z.string(), body: z.string() })

export function registerAppIpc(): void {
  // the renderer's toasts and background completions all come through here;
  // notifyOs itself decides whether it is worth an OS toast
  ipcMain.on(IPC.appNotify, (_event, input: unknown) => {
    const { title, body } = notifyInputSchema.parse(input)
    notifyOs(title, body)
  })
  ipcMain.on(IPC.appDimChrome, (_event, dimmed: unknown, fadeMs: unknown) => {
    setChromeDimmed(z.boolean().parse(dimmed), z.number().nonnegative().parse(fadeMs))
  })
}
