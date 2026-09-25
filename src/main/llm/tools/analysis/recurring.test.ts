import { describe, expect, it } from 'vitest'
import { fixtureContext, fixtureDb, noon } from './test-fixture'
import { detectRecurring, runRecurring } from './recurring'

describe('recurring', () => {
  const ctx = fixtureContext()
  const found = detectRecurring(ctx)
  const byMerchant = (name: RegExp): (typeof found)[number] | undefined =>
    found.find((c) => name.test(c.merchant))

  it('finds rent and utilities as bills', () => {
    expect(byMerchant(/oakwood/i)).toMatchObject({
      kind: 'bill',
      cadence: 'monthly',
      typicalAmount: 2000,
      nextExpected: '2026-10-01'
    })
    expect(byMerchant(/pgande/i)).toMatchObject({ kind: 'bill', priceChange: null })
  })

  it("finds Netflix and Spotify as subscriptions with Netflix's increase", () => {
    expect(byMerchant(/netflix/i)).toMatchObject({
      kind: 'subscription',
      typicalAmount: 17.99,
      priceChange: { from: 15.49, to: 17.99, on: '2026-05-05' }
    })
    expect(byMerchant(/spotify/i)).toMatchObject({ kind: 'subscription', priceChange: null })
  })

  it('leaves everyday habits out', () => {
    for (const habit of [/whole foods/i, /blue bottle/i, /tacos/i, /amazon/i])
      expect(byMerchant(habit)).toBeUndefined()
    expect(found).toHaveLength(4)
  })

  it('totals the rows and charts them', () => {
    const { result, chart } = runRecurring({ kind: 'all', chart: 'auto' }, ctx)
    const cost = result.columns!.indexOf('monthly_cost')
    const sum = result.rows!.reduce((s, r) => s + (r[cost] as number), 0)
    expect(result.facts).toMatchObject({
      count: 4,
      monthly_total: Math.round(sum * 100) / 100,
      subscriptions_monthly: 29.98,
      bills_monthly: 2100,
      largest: { monthly_cost: 2000 },
      price_increases: ['Netflix']
    })
    expect(result.rows![0][cost]).toBe(2000)
    expect(chart).toMatchObject({ type: 'bar', x: 'merchant', series: ['monthly_cost'] })
    const netflix = result.rows!.find((r) => r[0] === 'Netflix')!
    expect(netflix[result.columns!.indexOf('price_change')]).toBe('15.49 to 17.99 on 2026-05-05')
  })

  it('filters by kind', () => {
    const subs = runRecurring({ kind: 'subscriptions', chart: 'none' }, ctx)
    expect(subs.result.rows!.map((r) => r[2])).toEqual(['subscription', 'subscription'])
    expect(subs.result.facts).toMatchObject({ count: 2, monthly_total: 29.98 })
    expect(subs.result.facts).not.toHaveProperty('bills_monthly')
    expect(subs.chart).toBeNull()
    const bills = runRecurring({ kind: 'bills', chart: 'auto' }, ctx)
    expect(bills.result.facts).toMatchObject({ count: 2, monthly_total: 2100 })
  })

  it('finds a quarterly bill and spreads it per month', () => {
    const db = fixtureDb()
    const category = (
      db.prepare('SELECT id FROM categories WHERE name = ?').get('🛡️ Insurance') as { id: number }
    ).id
    const insert = db.prepare(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
       VALUES (1, ?, ?, -300000, 'STATE FARM INSURANCE', 0, ?, ?)`
    )
    for (const day of ['2025-12-10', '2026-03-10', '2026-06-10', '2026-09-10'])
      insert.run(`q${day}`, noon(day), noon(day), category)
    const farm = detectRecurring(fixtureContext(db)).find((c) => /state farm/i.test(c.merchant))
    expect(farm).toMatchObject({
      kind: 'bill',
      cadence: 'quarterly',
      monthlyCost: 100,
      nextExpected: '2026-12-10'
    })
  })

  it('says so when nothing was found', () => {
    const empty = runRecurring({ kind: 'all', chart: 'auto' }, { ...ctx, today: '2030-01-01' })
    expect(empty.result.facts).toMatchObject({ count: 0, monthly_total: 0 })
    expect(empty.result.notes?.[0]).toMatch(/No recurring charges found/)
    expect(empty.chart).toBeNull()
  })
})
