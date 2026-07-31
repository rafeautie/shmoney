import { db } from './db'
import { createLogger } from './logging'
import { settings } from './db/schema'
import {
  SETTINGS_DEFAULTS,
  settingKeySchema,
  settingSchemas,
  type SettingKey,
  type Settings
} from '@shared/settings'

const log = createLogger('settings')

/**
 * Every setting with defaults filled in. Main-process code (window bounds,
 * chrome colors, menus) reads through here rather than the settings IPC, which
 * only exists to answer the renderer.
 */
export function readSettings(): Settings {
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
}

export function writeSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
