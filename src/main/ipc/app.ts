import { ipcMain } from 'electron'
import { z } from 'zod'
import { notifyOs } from '../os-shell'
import { setChromeDimmed } from '../chrome-theme'
import { IPC } from '@shared/ipc'

const notifyInputSchema = z.object({ title: z.string(), body: z.string() })
const dimChromeInputSchema = z.tuple([z.boolean(), z.number().nonnegative()])

export function registerAppIpc(): void {
  // .on listeners have no caller to reject to, so a bad payload is dropped
  // rather than thrown in main (as log:write does)
  // the renderer's toasts and background completions all come through here;
  // notifyOs itself decides whether it is worth an OS toast
  ipcMain.on(IPC.appNotify, (_event, input: unknown) => {
    const parsed = notifyInputSchema.safeParse(input)
    if (!parsed.success) return
    notifyOs(parsed.data.title, parsed.data.body)
  })
  ipcMain.on(IPC.appDimChrome, (_event, dimmed: unknown, fadeMs: unknown) => {
    const parsed = dimChromeInputSchema.safeParse([dimmed, fadeMs])
    if (!parsed.success) return
    setChromeDimmed(...parsed.data)
  })
}
