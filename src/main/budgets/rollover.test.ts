import { describe, it, expect } from 'vitest'
import { computeEnvelopes, enumerateMonths, type BudgetFillRow } from './rollover'

function spendMap(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries))
}

describe('enumerateMonths', () => {
  it('lists an inclusive range', () => {
    expect(enumerateMonths('2026-05', '2026-07')).toEqual(['2026-05', '2026-06', '2026-07'])
  })

  it('crosses year boundaries', () => {
    expect(enumerateMonths('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02'
    ])
  })

  it('is a single month when start equals end', () => {
    expect(enumerateMonths('2026-07', '2026-07')).toEqual(['2026-07'])
  })

  it('is empty when start is after end', () => {
    expect(enumerateMonths('2026-08', '2026-07')).toEqual([])
  })
})

describe('computeEnvelopes', () => {
  const groceries: BudgetFillRow[] = [{ categoryId: 1, month: '2026-05', amount: 600_000 }]

  it('rolls unspent fill forward', () => {
    const [env] = computeEnvelopes(
      groceries,
      spendMap({ '1:2026-05': 500_000, '1:2026-06': 550_000 }),
      '2026-06'
    )
    // (600 - 500) + (600 - 550) = 150
    expect(env).toMatchObject({ fill: 600_000, spent: 550_000, balance: 150_000 })
  })

  it('carries overspending forward as a negative balance', () => {
    const [env] = computeEnvelopes(groceries, spendMap({ '1:2026-05': 700_000 }), '2026-06')
    // month 1: 600 - 700 = -100; month 2: -100 + 600 = 500
    expect(env.balance).toBe(500_000)
    const [may] = computeEnvelopes(groceries, spendMap({ '1:2026-05': 700_000 }), '2026-05')
    expect(may.balance).toBe(-100_000)
  })

  it('inherits the fill across gap months (sparse rows)', () => {
    const [env] = computeEnvelopes(groceries, new Map(), '2026-08')
    // 4 untouched months of 600 each
    expect(env).toMatchObject({ fill: 600_000, spent: 0, balance: 2_400_000 })
  })

  it('applies a fill change from its month forward without rewriting history', () => {
    const rows: BudgetFillRow[] = [
      { categoryId: 1, month: '2026-05', amount: 600_000 },
      { categoryId: 1, month: '2026-07', amount: 400_000 }
    ]
    const [env] = computeEnvelopes(rows, new Map(), '2026-07')
    // 600 + 600 + 400: May and June keep the original fill
    expect(env).toMatchObject({ fill: 400_000, balance: 1_600_000 })
  })

  it('accrues fills with zero spend for future months', () => {
    const [env] = computeEnvelopes(groceries, spendMap({ '1:2026-05': 600_000 }), '2026-07')
    // May breaks even, June and July accrue untouched
    expect(env).toMatchObject({ spent: 0, balance: 1_200_000 })
  })

  it('omits envelopes that start after the viewed month', () => {
    const rows: BudgetFillRow[] = [
      { categoryId: 1, month: '2026-05', amount: 600_000 },
      { categoryId: 2, month: '2026-08', amount: 100_000 }
    ]
    const envelopes = computeEnvelopes(rows, new Map(), '2026-06')
    expect(envelopes.map((e) => e.categoryId)).toEqual([1])
  })

  it('crosses year boundaries', () => {
    const rows: BudgetFillRow[] = [{ categoryId: 1, month: '2025-12', amount: 100_000 }]
    const [env] = computeEnvelopes(rows, spendMap({ '1:2026-01': 50_000 }), '2026-01')
    expect(env.balance).toBe(150_000)
  })

  it('ignores spend outside the envelope window', () => {
    const [env] = computeEnvelopes(groceries, spendMap({ '1:2026-04': 999_000 }), '2026-05')
    // April spending predates the envelope and never counts against it
    expect(env.balance).toBe(600_000)
  })

  it('handles several envelopes independently', () => {
    const rows: BudgetFillRow[] = [
      { categoryId: 1, month: '2026-06', amount: 600_000 },
      { categoryId: 2, month: '2026-06', amount: 200_000 }
    ]
    const envelopes = computeEnvelopes(
      rows,
      spendMap({ '1:2026-06': 100_000, '2:2026-06': 300_000 }),
      '2026-06'
    )
    expect(envelopes.find((e) => e.categoryId === 1)?.balance).toBe(500_000)
    expect(envelopes.find((e) => e.categoryId === 2)?.balance).toBe(-100_000)
  })
})
