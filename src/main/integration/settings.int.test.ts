import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS, settingSchemas, type SettingKey } from '@shared/settings'
import { nativeTheme } from '../../demo/shims/electron'
import { applyRulesOnSyncEnabled, detectTransfersEnabled } from '../ipc/connections'
import { api } from './harness/api'
import { account, category, txn } from './harness/builders'
import { count, query } from './harness/db'

const stored = (key: string): string[] =>
  query<{ value: string }>(`SELECT value FROM settings WHERE key = '${key}'`).map((r) => r.value)

const forceRaw = (key: string, rawJson: string): void => {
  query(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${rawJson}')`)
}

describe('settings defaults', () => {
  it('returns every default on a fresh database', async () => {
    expect(count('settings')).toBe(0)
    expect(await api.settings.getAll()).toEqual(SETTINGS_DEFAULTS)
  })

  it('has a default for every schema key and nothing else', () => {
    expect(Object.keys(SETTINGS_DEFAULTS).sort()).toEqual(Object.keys(settingSchemas).sort())
  })

  it('serves the same snapshot through initial()', async () => {
    expect(await api.settings.initial()).toEqual(SETTINGS_DEFAULTS)
  })
})

describe('settings set', () => {
  it('round-trips a boolean', async () => {
    expect(await api.settings.set('blurAmounts', true)).toBe(true)
    expect((await api.settings.getAll()).blurAmounts).toBe(true)
    await api.settings.set('blurAmounts', false)
    expect((await api.settings.getAll()).blurAmounts).toBe(false)
  })

  it('round-trips an enum', async () => {
    await api.settings.set('goalsView', 'table')
    await api.settings.set('activitySource', 'rule')
    const all = await api.settings.getAll()
    expect(all.goalsView).toBe('table')
    expect(all.activitySource).toBe('rule')
  })

  it('round-trips a number', async () => {
    await api.settings.set('llmUsageSince', 1_760_000_000_000)
    expect((await api.settings.getAll()).llmUsageSince).toBe(1_760_000_000_000)
  })

  it('round-trips an object, with and without its optional fields', async () => {
    await api.settings.set('windowState', { width: 900, height: 700, maximized: false })
    expect((await api.settings.getAll()).windowState).toEqual({
      width: 900,
      height: 700,
      maximized: false
    })
    const placed = { x: 10, y: 20, width: 1000, height: 800, maximized: true }
    await api.settings.set('windowState', placed)
    expect((await api.settings.getAll()).windowState).toEqual(placed)
  })

  it('stores null as the JSON literal and reads it back as null', async () => {
    await api.settings.set('llmUsageSince', 5)
    await api.settings.set('llmUsageSince', null)
    expect(query("SELECT json_type(value) AS t FROM settings WHERE key = 'llmUsageSince'")).toEqual(
      [{ t: 'null' }]
    )
    expect((await api.settings.getAll()).llmUsageSince).toBeNull()
    await api.settings.set('windowState', null)
    expect((await api.settings.getAll()).windowState).toBeNull()
  })

  it('writes one row per key, replacing on repeat', async () => {
    await api.settings.set('sidebarOpen', false)
    await api.settings.set('sidebarOpen', true)
    await api.settings.set('sidebarOpen', false)
    expect(count('settings', "key = 'sidebarOpen'")).toBe(1)
    expect((await api.settings.getAll()).sidebarOpen).toBe(false)
  })

  it('leaves other keys alone', async () => {
    await api.settings.set('nativeNotifications', false)
    const all = await api.settings.getAll()
    expect(all.nativeNotifications).toBe(false)
    expect(all.detectTransfers).toBe(SETTINGS_DEFAULTS.detectTransfers)
  })

  it('rejects an unknown key and writes nothing', async () => {
    const before = count('settings')
    await expect(api.settings.set('bogus' as SettingKey, true as never)).rejects.toThrow()
    expect(count('settings')).toBe(before)
  })

  it('rejects a wrong-typed value and keeps the old one', async () => {
    await api.settings.set('blurAmounts', true)
    await api.settings.set('goalsView', 'table')
    await expect(api.settings.set('blurAmounts', 'yes' as never)).rejects.toThrow()
    await expect(api.settings.set('goalsView', 'grid' as never)).rejects.toThrow()
    await expect(api.settings.set('llmUsageSince', '5' as never)).rejects.toThrow()
    await expect(api.settings.set('windowState', { width: 1 } as never)).rejects.toThrow()
    await expect(api.settings.set('blurAmounts', null as never)).rejects.toThrow()
    const all = await api.settings.getAll()
    expect(all.blurAmounts).toBe(true)
    expect(all.goalsView).toBe('table')
  })

  it('rejects a malformed payload', async () => {
    await expect(api.settings.set(undefined as never, true as never)).rejects.toThrow()
  })
})

describe('settings stored values that no longer parse', () => {
  it('falls back to the default for that key only', async () => {
    await api.settings.set('sidebarOpen', false)
    forceRaw('theme', '"neon"')
    forceRaw('goalsView', '42')
    const all = await api.settings.getAll()
    expect(all.theme).toBe(SETTINGS_DEFAULTS.theme)
    expect(all.goalsView).toBe(SETTINGS_DEFAULTS.goalsView)
    expect(all.sidebarOpen).toBe(false)
  })

  it('ignores a row whose key is not a setting any more', async () => {
    forceRaw('retiredSetting', 'true')
    expect(await api.settings.getAll()).not.toHaveProperty('retiredSetting')
  })

  it('recovers once a valid value is written over the bad one', async () => {
    forceRaw('theme', '"neon"')
    await api.settings.set('theme', 'light')
    expect((await api.settings.getAll()).theme).toBe('light')
  })
})

describe('settings theme', () => {
  it('persists the theme and mirrors it onto the native theme source', async () => {
    for (const theme of ['light', 'system', 'dark'] as const) {
      await api.settings.set('theme', theme)
      expect(nativeTheme.themeSource).toBe(theme)
      expect((await api.settings.getAll()).theme).toBe(theme)
    }
  })

  it('does not touch the native theme for other keys', async () => {
    await api.settings.set('theme', 'light')
    await api.settings.set('blurAmounts', true)
    expect(nativeTheme.themeSource).toBe('light')
  })

  it('leaves the native theme alone when the theme is rejected', async () => {
    await api.settings.set('theme', 'dark')
    await expect(api.settings.set('theme', 'blue' as never)).rejects.toThrow()
    expect(nativeTheme.themeSource).toBe('dark')
  })
})

describe('settings read by main as raw flags', () => {
  it('turns each sync flag off through the API', async () => {
    await api.settings.set('detectTransfers', false)
    await api.settings.set('applyRulesOnSync', false)
    await api.settings.set('ruleSuggestionsEnabled', false)
    expect(stored('detectTransfers')).toEqual(['false'])
    expect(stored('applyRulesOnSync')).toEqual(['false'])
    expect(stored('ruleSuggestionsEnabled')).toEqual(['false'])
    const all = await api.settings.getAll()
    expect([all.detectTransfers, all.applyRulesOnSync, all.ruleSuggestionsEnabled]).toEqual([
      false,
      false,
      false
    ])
  })

  it('reads a non-boolean stored value as the default through getAll', async () => {
    forceRaw('detectTransfers', '"off"')
    forceRaw('applyRulesOnSync', '0')
    forceRaw('ruleSuggestionsEnabled', 'null')
    const all = await api.settings.getAll()
    expect([all.detectTransfers, all.applyRulesOnSync, all.ruleSuggestionsEnabled]).toEqual([
      true,
      true,
      true
    ])
  })

  it('main reads the sync flags through the schema, so an invalid stored value means the default', async () => {
    const acct = account()
    const target = category()
    for (let i = 0; i < 3; i++) txn(acct, { description: 'SETTINGS FLAG', categoryId: target })
    query(
      `INSERT INTO rule_suggestions (description_key, phrase, category_id, match_count, source, created_at, updated_at) VALUES ('SETTINGS FLAG', 'SETTINGS FLAG', ${target}, 3, 'user', 0, 0)`
    )
    const listed = async (): Promise<string[]> =>
      (await api.ruleSuggestions.list()).map((s) => s.descriptionKey)
    forceRaw('detectTransfers', '"off"')
    forceRaw('applyRulesOnSync', '0')
    forceRaw('ruleSuggestionsEnabled', 'null')

    expect([detectTransfersEnabled(), applyRulesOnSyncEnabled()]).toEqual([true, true])
    expect(await listed()).toEqual(['SETTINGS FLAG'])

    // every default is on, so flip them to tell "fell back to the default" from "anything but false is on"
    const defaults = { ...SETTINGS_DEFAULTS }
    Object.assign(SETTINGS_DEFAULTS, {
      detectTransfers: false,
      applyRulesOnSync: false,
      ruleSuggestionsEnabled: false
    })
    try {
      expect([detectTransfersEnabled(), applyRulesOnSyncEnabled()]).toEqual([false, false])
      expect(await listed()).toEqual([])
    } finally {
      Object.assign(SETTINGS_DEFAULTS, defaults)
    }
  })
})
