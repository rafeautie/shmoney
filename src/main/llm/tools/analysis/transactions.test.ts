import { describe, expect, it } from 'vitest'
import { addEuroCard, fixtureContext, fixtureDb, fixtureTransactions } from './test-fixture'
import { runTransactions } from './transactions'

const txs = fixtureTransactions().filter((t) => t.category !== '🔄 Transfers')

const args = (over: Record<string, unknown>): Record<string, unknown> => ({
  sort: 'largest',
  direction: 'spending',
  period: 'all',
  category: null,
  account: null,
  search: null,
  limit: 10,
  ...over
})

describe('transactions', () => {
  const ctx = fixtureContext()

  it('finds the largest purchase last month', () => {
    const { result, chart } = runTransactions(args({ period: 'last_month', limit: 1 }), ctx)
    const august = txs.filter((t) => t.day.startsWith('2026-08') && t.amount < 0)
    const biggest = august.reduce((a, b) => (b.amount < a.amount ? b : a))
    expect(result.period).toBe('2026-08')
    expect(result.facts).toEqual({
      count: august.length,
      total_spending: expect.closeTo(
        august.reduce((s, t) => s - t.amount, 0),
        2
      ),
      shown: 1,
      largest: {
        date: biggest.day,
        merchant: 'Oakwood Properties',
        amount: -biggest.amount
      }
    })
    expect(result.columns).toEqual([
      'date',
      'merchant',
      'description',
      'category',
      'account',
      'amount'
    ])
    expect(result.rows![0][5]).toBe(biggest.amount)
    expect(chart).toBeNull()
  })

  it('lists Amazon orders, largest first, with what the search matched', () => {
    const { result } = runTransactions(args({ search: 'amazon', limit: 25 }), ctx)
    const amazon = txs.filter((t) => t.description.startsWith('AMAZON'))
    expect(result.facts!.count).toBe(amazon.length)
    expect(result.facts!.total_spending).toBeCloseTo(
      amazon.reduce((s, t) => s - t.amount, 0),
      2
    )
    expect(result.rows!.every((r) => r[1] === 'Amazon')).toBe(true)
    expect(result.rows![0].slice(0, 2)).toEqual(['2026-07-18', 'Amazon'])
    expect(result.rows![0][5]).toBe(-600)
    expect(result.notes).toContain(`'amazon' matched Amazon (${amazon.length}).`)
  })

  it('sorts newest first and filters income', () => {
    const { result } = runTransactions(args({ sort: 'newest', direction: 'income' }), ctx)
    const income = txs.filter((t) => t.amount > 0)
    expect(result.facts!.count).toBe(income.length)
    expect(result.facts!.total_income).toBeCloseTo(
      income.reduce((s, t) => s + t.amount, 0),
      2
    )
    const dates = result.rows!.map((r) => r[0] as string)
    expect(dates[0]).toBe(
      income
        .map((t) => t.day)
        .sort()
        .at(-1)
    )
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('clamps the limit', () => {
    expect(runTransactions(args({ limit: 100 }), ctx).result.rows).toHaveLength(25)
    expect(runTransactions(args({ limit: 2.5 }), ctx).result.rows).toHaveLength(10)
    expect(runTransactions(args({ limit: 0 }), ctx).result.rows).toHaveLength(1)
  })

  it('reports an empty period with its coverage note', () => {
    const { result } = runTransactions(args({ period: '2025-03' }), ctx)
    expect(result.facts).toMatchObject({ count: 0, total_spending: 0, shown: 0 })
    expect(result.notes![0]).toMatch(/^No transactions in 2025-03/)
  })
})

describe('transactions in several currencies', () => {
  it('totals each currency apart and labels every row', () => {
    const db = fixtureDb()
    addEuroCard(db, [
      { day: '2026-08-05', amount: -50, description: 'CAFE DE FLORE', category: null },
      { day: '2026-08-06', amount: -2400, description: 'HOTEL LUTETIA', category: null }
    ])
    const { result } = runTransactions(args({ period: '2026-08', limit: 1 }), fixtureContext(db))
    const august = txs.filter((t) => t.day.startsWith('2026-08') && t.amount < 0)
    expect(result.facts).toEqual({
      count: august.length + 2,
      total_spending_USD: expect.closeTo(
        august.reduce((s, t) => s - t.amount, 0),
        2
      ),
      total_spending_EUR: 2450,
      shown: 1,
      largest: { date: '2026-08-06', merchant: 'Hotel Lutetia', amount: 2400, currency: 'EUR' }
    })
    expect(result.columns!.at(-1)).toBe('currency')
    expect(result.rows![0].at(-1)).toBe('EUR')
    expect(result.notes).toContain('Amounts in different currencies are never added together.')
  })
})
