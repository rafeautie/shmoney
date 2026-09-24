import { describe, expect, it } from 'vitest'
import { fetchAccounts } from '../simplefin'
import { DATASETS, demoAccountSet } from './index'

const NOW = new Date(2026, 8, 23, 15)

describe('demo datasets', () => {
  it.each(DATASETS.map((d) => d.id))('%s is deterministic for a given day', (id) => {
    expect(demoAccountSet(id, NOW)).toEqual(demoAccountSet(id, NOW))
  })

  it.each(DATASETS.map((d) => d.id))(
    '%s keeps a transaction id when later days are added',
    (id) => {
      const today = demoAccountSet(id, NOW)
      const tomorrow = demoAccountSet(id, new Date(2026, 8, 24, 15))
      const ids = (set: typeof today): Set<string> =>
        new Set(set.accounts.flatMap((a) => a.transactions.map((t) => t.id)))
      const later = ids(tomorrow)
      const day = (txnId: string): string => /-(\d{8})-/.exec(txnId)![1]
      const firstDay = [...ids(today)].map(day).sort()[0]
      // everything but the day that scrolled out of the window survives
      const lost = [...ids(today)].filter((txnId) => !later.has(txnId))
      expect(lost.every((txnId) => day(txnId) === firstDay)).toBe(true)
    }
  )

  it.each(DATASETS.map((d) => d.id))('%s parses as a SimpleFIN payload', async (id) => {
    const payload = await fetchAccounts(`demo:${id}`, 0)
    expect(payload.accounts.length).toBeGreaterThan(0)
    expect(new Set(payload.accounts.flatMap((a) => a.transactions.map((t) => t.id))).size).toBe(
      payload.accounts.reduce((n, a) => n + a.transactions.length, 0)
    )
  })
})
