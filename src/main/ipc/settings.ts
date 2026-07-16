import { ipcMain } from 'electron'
import { z } from 'zod'
import { db } from '../db'
import { createLogger } from '../logging'
import { settings } from '../db/schema'
import {
  SETTINGS_DEFAULTS,
  SETTINGS_IPC,
  settingKeySchema,
  settingSchemas,
  type Settings
} from '@shared/settings'

const setInputSchema = z.object({ key: settingKeySchema, value: z.unknown() })

const log = createLogger('settings')

export function registerSettingsIpc(): void {
  ipcMain.handle(SETTINGS_IPC.getAll, (): Settings => {
    const rows = db.select().from(settings).all()
    const result: Settings = { ...SETTINGS_DEFAULTS }
    // values are stored as JSON; if a row no longer parses (schema drift),
    // fall back to the default instead of crashing the renderer
    for (const row of rows) {
      const key = settingKeySchema.safeParse(row.key)
      if (!key.success) continue
      const value = settingSchemas[key.data].safeParse(row.value)
      if (!value.success) {
        log.warn('setting.parse-failed', { key: row.key })
        continue
      }
      // TS can't correlate key.data with value.data across the loop
      ;(result as Record<string, unknown>)[key.data] = value.data
    }
    return result
  })

  ipcMain.handle(SETTINGS_IPC.set, (_event, input: unknown): boolean => {
    const { key, value: raw } = setInputSchema.parse(input)
    const value = settingSchemas[key].parse(raw)
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
    return true
  })
}
