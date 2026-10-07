import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATEGORY_GROUPS } from '../db/defaults'
import { listDatasets } from '../demo-data'
import { api } from './harness/api'
import { count, query } from './harness/db'

// every table a dataset writes, plus the category tables seeding resets
const DATA_TABLES = [
  'chat_messages',
  'conversations',
  'action_log',
  'action_runs',
  'rule_suggestions',
  'rules',
  'budgets',
  'savings_goal_accounts',
  'savings_goals',
  'report_widgets',
  'reports',
  'saved_filters',
  'holdings',
  'transactions',
  'accounts',
  'connections'
]

const counts = (): Record<string, number> =>
  Object.fromEntries(DATA_TABLES.map((table) => [table, count(table)]))

describe('app fire-and-forget channels', () => {
  const focused = (value: boolean): void => {
    vi.stubGlobal('document', { hasFocus: () => value })
  }

  it('accepts a notification whether or not the window is focused', () => {
    focused(true)
    expect(() => api.app.notify('Sync finished', '3 new transactions')).not.toThrow()
    focused(false)
    expect(() => api.app.notify('Sync finished', '3 new transactions')).not.toThrow()
  })

  it('accepts an empty title and body', () => {
    focused(false)
    expect(() => api.app.notify('', '')).not.toThrow()
  })

  it('accepts the renderer-ready signal', () => {
    expect(() => api.app.ready()).not.toThrow()
  })

  it('drops an invalid notify payload instead of throwing in main', () => {
    focused(false)
    expect(() => api.app.notify(42 as never, 'body')).not.toThrow()
    expect(() => api.app.notify('title', undefined as never)).not.toThrow()
  })
})

describe('log:write', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => {
    warn.mockClear()
    error.mockClear()
  })

  it('writes a valid warning with its detail', () => {
    api.log.write({ level: 'warn', event: 'chart.render-failed', detail: 'stack here' })
    expect(warn).toHaveBeenCalledWith('[renderer]', 'chart.render-failed', { detail: 'stack here' })
    expect(error).not.toHaveBeenCalled()
  })

  it('writes a valid error with its detail as the cause', () => {
    api.log.write({ level: 'error', event: 'boom', detail: 'Error: boom' })
    expect(error).toHaveBeenCalledWith('[renderer]', 'boom', 'Error: boom', '')
  })

  it('accepts info and an entry with no detail', () => {
    expect(() => api.log.write({ level: 'info', event: 'app.started' })).not.toThrow()
    expect(() => api.log.write({ level: 'warn', event: 'bare' })).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[renderer]', 'bare', '')
  })

  it('accepts the limits of event and detail length', () => {
    api.log.write({ level: 'warn', event: 'e'.repeat(200), detail: 'd'.repeat(8000) })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('drops invalid input silently', () => {
    const invalid: unknown[] = [
      { level: 'debug', event: 'x' },
      { level: 'warn', event: '' },
      { level: 'warn', event: 'e'.repeat(201) },
      { level: 'warn', event: 'x', detail: 'd'.repeat(8001) },
      { level: 'warn', event: 42 },
      { level: 'warn' },
      { event: 'no level' },
      'just a string',
      null,
      undefined
    ]
    for (const entry of invalid) {
      expect(() => api.log.write(entry as never)).not.toThrow()
    }
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('demo datasets', () => {
  it('lists household and starter', async () => {
    const datasets = await api.demo.datasets()
    expect(datasets.map((d) => d.id)).toEqual(['household', 'starter'])
    expect(datasets).toEqual(listDatasets())
    for (const dataset of datasets) {
      expect(dataset.name).not.toBe('')
      expect(dataset.description).not.toBe('')
    }
  })

  it('rejects an unknown dataset without touching existing data', async () => {
    await api.settings.set('theme', 'light')
    const before = counts()
    await expect(api.demo.seed('nope')).rejects.toThrow('Unknown demo dataset "nope"')
    await expect(api.demo.seed('')).rejects.toThrow()
    expect(counts()).toEqual(before)
    expect((await api.settings.getAll()).theme).toBe('light')
  })

  it('seeds the household through the real sync', async () => {
    await api.demo.seed('household')
    const seeded = counts()
    expect(seeded.connections).toBe(1)
    expect(seeded.accounts).toBe(4)
    expect(seeded.holdings).toBe(3)
    expect(seeded.transactions).toBeGreaterThan(500)
    for (const table of [
      'rules',
      'budgets',
      'reports',
      'report_widgets',
      'savings_goals',
      'saved_filters',
      'rule_suggestions',
      'conversations',
      'chat_messages'
    ]) {
      expect(seeded[table], table).toBeGreaterThan(0)
    }
    const settings = await api.settings.getAll()
    expect(settings.onboardingComplete).toBe(true)
    expect(settings.activitySeenAt).toBeGreaterThan(0)
  })

  it('serves what it seeded through the other channels', async () => {
    expect(await api.connection.get()).not.toBeNull()
    expect((await api.accounts.list()).length).toBe(4)
    expect((await api.rules.list()).length).toBe(count('rules'))
    expect((await api.reports.list()).length).toBe(count('reports'))
    expect((await api.goals.list()).length).toBe(count('savings_goals'))
    expect((await api.savedFilters.list()).length).toBe(count('saved_filters'))
  })

  it('seeding twice leaves the same counts, with ids restarted', async () => {
    const first = counts()
    await api.demo.seed('household')
    expect(counts()).toEqual(first)
    expect(query('SELECT min(id) AS id FROM accounts')).toEqual([{ id: 1 }])
    expect(query('SELECT min(id) AS id FROM reports')).toEqual([{ id: 1 }])
  })

  it('replaces the dataset when another is seeded', async () => {
    const household = counts()
    await api.demo.seed('starter')
    const starter = counts()
    expect(starter).not.toEqual(household)
    expect(starter.accounts).toBeGreaterThan(0)
    expect(starter.accounts).toBeLessThan(household.accounts)
    expect(starter.transactions).toBeLessThan(household.transactions)
    expect(count('connections')).toBe(1)
    expect((await api.settings.getAll()).onboardingComplete).toBe(true)
  })
})

describe('demo clear', () => {
  it('returns to a fresh install but keeps display preferences', async () => {
    await api.demo.seed('household')
    await api.settings.set('theme', 'light')
    await api.settings.set('blurAmounts', true)
    await api.settings.set('sidebarOpen', false)
    expect(count('transactions')).toBeGreaterThan(0)

    await api.demo.clear()

    expect(Object.values(counts()).every((n) => n === 0)).toBe(true)
    expect(count('transactions')).toBe(0)
    const settings = await api.settings.getAll()
    expect(settings.onboardingComplete).toBe(false)
    expect(settings.activitySeenAt).toBeNull()
    expect(settings.theme).toBe('light')
    expect(settings.blurAmounts).toBe(true)
    expect(settings.sidebarOpen).toBe(false)
    expect(count('settings', "key IN ('onboardingComplete', 'activitySeenAt')")).toBe(0)
    expect(count('settings', "key IN ('theme', 'blurAmounts', 'sidebarOpen')")).toBe(3)
  })

  it('resets categories to the defaults, keeping the system ones', async () => {
    await api.demo.seed('household')
    await api.categories.createGroup({ name: 'My extra group' })
    await api.demo.clear()
    const list = await api.categories.list()
    expect(list.groups.map((g) => g.name).sort()).toEqual(
      DEFAULT_CATEGORY_GROUPS.map((g) => g.name).sort()
    )
    expect(list.groups.reduce((sum, g) => sum + g.categories.length, 0)).toBe(
      DEFAULT_CATEGORY_GROUPS.reduce((sum, g) => sum + g.categories.length, 0)
    )
    expect(list.ungrouped).toEqual([])
    expect(count('categories', 'system_key IS NOT NULL')).toBe(3)
  })

  it('is harmless on an already empty database', async () => {
    await api.demo.clear()
    await expect(api.demo.clear()).resolves.toBeUndefined()
    expect(counts().transactions).toBe(0)
  })

  it('lets a dataset be seeded again afterwards', async () => {
    await api.demo.seed('starter')
    expect(count('accounts')).toBeGreaterThan(0)
    expect((await api.settings.getAll()).onboardingComplete).toBe(true)
  })
})
