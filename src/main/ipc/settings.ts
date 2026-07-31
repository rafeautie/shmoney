import { ipcMain } from 'electron'
import { z } from 'zod'
import { applyTheme } from '../chrome-theme'
import { readSettings, writeSetting } from '../settings-store'
import { SETTINGS_IPC, settingKeySchema, settingSchemas, type Settings } from '@shared/settings'

const setInputSchema = z.object({ key: settingKeySchema, value: z.unknown() })

export function registerSettingsIpc(): void {
  ipcMain.handle(SETTINGS_IPC.getAll, (): Settings => readSettings())

  ipcMain.handle(SETTINGS_IPC.set, (_event, input: unknown): boolean => {
    const { key, value: raw } = setInputSchema.parse(input)
    const value = settingSchemas[key].parse(raw)
    writeSetting(key, value as Settings[typeof key])
    // the window background and native caption buttons live outside the
    // renderer, so main has to repaint them itself
    if (key === 'theme') applyTheme(value as Settings['theme'])
    return true
  })
}
