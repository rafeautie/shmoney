import { describe, expect, it } from 'vitest'
import { runWhatIf } from './what-if'
import { addEuroCard, fixtureContext, fixtureDb, fixtureTransactions } from './test-fixture'

const round2 = (n: number): number => Math.round(n * 100) / 100

// the last 6 complete months before 2026-09-24
const inWindow = fixtureTransactions().filter(
  (t) => t.day >= '2026-03-01' && t.day <= '2026-08-31' && t.category !== '🔄 Transfers'
)
const spending = (pick: (t: (typeof inWindow)[number]) => boolean = () => true): number =>
  -inWindow.filter((t) => t.amount < 0 && pick(t)).reduce((s, t) => s + t.amount, 0) / 6
const income = inWindow.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0) / 6

const args = (over: Record<string, unknown>): Record<string, unknown> => ({
  category: null,
  search: null,
  change_percent: null,
  change_per_month: null,
  goal: null,
  ...over
})

describe('what_if tool', () => {
  it('halves a category and moves a goal earlier', () => {
    const out = runWhatIf(
      args({ category: '🛒 Groceries', change_percent: -50, goal: 'Trip to Japan' }),
      fixtureContext()
    )
    expect(out.result.ok).toBe(true)
    expect(out.chart).toBeNull()
    const groceries = spending((t) => t.category === '🛒 Groceries')
    const saving = groceries / 2
    const net = income - spending()
    expect(out.result.facts).toEqual({
      target: '🛒 Groceries',
      months_averaged: 6,
      current_monthly_spending: round2(groceries),
      new_monthly_spending: round2(groceries - saving),
      monthly_saving: round2(saving),
      yearly_saving: round2(saving * 12),
      net_per_month_now: round2(net),
      net_per_month_after: round2(net + saving),
      savings_rate_now_percent: Math.round((net / income) * 1000) / 10,
      savings_rate_after_percent: Math.round(((net + saving) / income) * 1000) / 10,
      goal: 'Trip to Japan',
      // 3500 left at 500 a month is 7 months; at 734 it is 5
      goal_projected_date_now: '2027-04-24',
      goal_projected_date_after: '2027-02-24',
      months_sooner: 2
    })
  })

  it('stops a merchant found by search', () => {
    const out = runWhatIf(args({ search: 'netflix', change_percent: -100 }), fixtureContext())
    const netflix = spending((t) => t.description === 'NETFLIX.COM')
    expect(out.result.facts).toMatchObject({
      target: "'netflix'",
      current_monthly_spending: round2(netflix),
      new_monthly_spending: 0,
      monthly_saving: round2(netflix),
      yearly_saving: round2(netflix * 12)
    })
    expect(out.result.notes?.join(' ')).toMatch(/Netflix/i)
  })

  it('applies a per-month change to all spending and clamps at zero', () => {
    const out = runWhatIf(
      args({ category: '🍽️ Dining Out', change_per_month: -200 }),
      fixtureContext()
    )
    const dining = spending((t) => t.category === '🍽️ Dining Out')
    expect(out.result.facts).toMatchObject({
      new_monthly_spending: 0,
      monthly_saving: round2(dining)
    })
    const all = runWhatIf(args({ change_per_month: -200 }), fixtureContext())
    expect(all.result.facts).toMatchObject({
      target: 'all spending',
      current_monthly_spending: round2(spending()),
      monthly_saving: 200,
      yearly_saving: 2400
    })
  })

  it('asks for a change when none is given', () => {
    const out = runWhatIf(args({ category: '🛒 Groceries' }), fixtureContext())
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toMatch(/change_percent/)
  })

  it('says when a goal is already reached', () => {
    const ctx = fixtureContext()
    ctx.goalPace = ctx.goalPace.map((g) => (g.id === 1 ? { ...g, progress: g.targetAmount } : g))
    const out = runWhatIf(args({ change_percent: -10, goal: 'Trip to Japan' }), ctx)
    expect(out.result.notes).toContain('Trip to Japan is already reached.')
    expect(out.result.facts).not.toHaveProperty('goal_projected_date_after')
  })
})

describe('what_if with a merchant inside a category', () => {
  it('narrows to the merchant when both are given', () => {
    const both = runWhatIf(
      {
        category: '📺 Subscriptions',
        search: 'netflix',
        change_percent: -100,
        change_per_month: null,
        goal: null
      },
      fixtureContext()
    )
    const merchant = runWhatIf(
      {
        category: null,
        search: 'netflix',
        change_percent: -100,
        change_per_month: null,
        goal: null
      },
      fixtureContext()
    )
    expect(both.result.facts!.monthly_saving).toBe(merchant.result.facts!.monthly_saving)
  })
})

describe('what_if with several currencies', () => {
  it('averages the main currency only and says what it left out', () => {
    const db = fixtureDb()
    addEuroCard(db, [
      { day: '2026-05-10', amount: -300, description: 'CARREFOUR PARIS', category: '🛒 Groceries' },
      { day: '2026-07-04', amount: -80, description: 'CAFE DE FLORE', category: '🍽️ Dining Out' }
    ])
    const out = runWhatIf(
      args({ category: '🛒 Groceries', change_percent: -50 }),
      fixtureContext(db)
    )
    const groceries = spending((t) => t.category === '🛒 Groceries')
    expect(out.result.facts).toMatchObject({
      current_monthly_spending: round2(groceries),
      net_per_month_now: round2(income - spending())
    })
    expect(out.result.notes).toContain(
      'Only USD amounts are counted; EUR was left out, since currencies are never added together.'
    )
  })
})
