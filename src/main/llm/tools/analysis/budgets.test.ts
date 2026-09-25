import { describe, expect, it } from 'vitest'
import { runBudgets } from './budgets'
import { addEuroCard, fixtureContext, fixtureDb, fixtureTransactions } from './test-fixture'

const round2 = (n: number): number => Math.round(n * 100) / 100

const spentIn = (category: string, month: string): number =>
  round2(
    -fixtureTransactions()
      .filter((t) => t.category === category && t.day.startsWith(month) && t.amount < 0)
      .reduce((s, t) => s + t.amount, 0)
  )

/** rolling rollover: every month's budget minus spending, from the first budgeted month */
const available = (category: string, first: string, month: string, budget: number): number => {
  let total = 0
  for (let m = first; m <= month; m = nextMonth(m)) total += budget - spentIn(category, m)
  return round2(total)
}
const nextMonth = (m: string): string => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

describe('budgets tool', () => {
  it('reads the current month with pace and goal savings', () => {
    const out = runBudgets({ month: null, chart: 'auto' }, fixtureContext())
    expect(out.result.ok).toBe(true)
    const dining = spentIn('🍽️ Dining Out', '2026-09')
    const groceries = spentIn('🛒 Groceries', '2026-09')
    expect(dining).toBeGreaterThan(60)
    expect(out.result.rows).toEqual([
      [
        '🍽️ Dining Out',
        60,
        dining,
        available('🍽️ Dining Out', '2026-06', '2026-09', 60),
        Math.round((dining / 60) * 1000) / 10,
        round2((dining / 24) * 30),
        'over'
      ],
      [
        '🛒 Groceries',
        500,
        groceries,
        available('🛒 Groceries', '2026-01', '2026-09', 500),
        Math.round((groceries / 500) * 1000) / 10,
        round2((groceries / 24) * 30),
        'on track'
      ]
    ])
    expect(out.result.facts).toEqual({
      month: '2026-09',
      budgeted: 560,
      spent: round2(dining + groceries),
      available: round2(
        available('🍽️ Dining Out', '2026-06', '2026-09', 60) +
          available('🛒 Groceries', '2026-01', '2026-09', 500)
      ),
      over: ['🍽️ Dining Out'],
      at_risk: [],
      days_left: 6,
      saved_toward_goals: 800,
      planned_saving: 944.44
    })
    expect(out.chart).toMatchObject({ type: 'bar', x: 'category', series: ['budget', 'spent'] })
  })

  it('reads a past month without pace', () => {
    const out = runBudgets({ month: '2026-08', chart: 'none' }, fixtureContext())
    expect(out.chart).toBeNull()
    expect(out.result.facts).toMatchObject({
      month: '2026-08',
      budgeted: 560,
      over: [],
      at_risk: [],
      saved_toward_goals: 1300,
      planned_saving: 944.44
    })
    expect(out.result.facts).not.toHaveProperty('days_left')
    expect(out.result.rows?.every((r) => r[5] === null)).toBe(true)
  })

  it('notes a month with no budgets', () => {
    const out = runBudgets({ month: '2025-11', chart: 'auto' }, fixtureContext())
    expect(out.result).toMatchObject({ ok: true, notes: ['No budgets are set for 2025-11.'] })
  })

  it('rejects a malformed month', () => {
    const out = runBudgets({ month: 'July', chart: 'auto' }, fixtureContext())
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toMatch(/YYYY-MM/)
  })
})

describe('budgets with spending in another currency', () => {
  it('counts the main currency against the budget, this month and rolled over', () => {
    const db = fixtureDb()
    addEuroCard(db, [
      { day: '2026-07-04', amount: -80, description: 'CAFE DE FLORE', category: '🍽️ Dining Out' },
      { day: '2026-09-06', amount: -40, description: 'CAFE DE FLORE', category: '🍽️ Dining Out' }
    ])
    const plain = runBudgets({ month: null, chart: 'none' }, fixtureContext())
    const mixed = runBudgets({ month: null, chart: 'none' }, fixtureContext(db))
    expect(mixed.result.rows).toEqual(plain.result.rows)
    expect(mixed.result.facts).toEqual(plain.result.facts)
    expect(mixed.result.notes).toEqual([
      'Only USD amounts are counted; EUR was left out, since currencies are never added together.'
    ])
    expect(plain.result.notes).toBeUndefined()
  })
})
