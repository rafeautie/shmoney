import { describe, expect, it } from 'vitest'
import { runGoals } from './goals'
import { addEuroCard, fixtureContext, fixtureDb, fixtureTransactions } from './test-fixture'

const round2 = (n: number): number => Math.round(n * 100) / 100

/** income minus spending averaged over 2026-03..2026-08, straight from the seed */
function expectedNet(): number {
  const rows = fixtureTransactions().filter(
    (t) => t.day >= '2026-03-01' && t.day <= '2026-08-31' && t.category !== '🔄 Transfers'
  )
  return round2(rows.reduce((s, t) => s + t.amount, 0) / 6)
}

describe('goals tool', () => {
  it('summarizes every goal from temp.goals', () => {
    const out = runGoals({ goal: null, view: 'status', chart: 'auto' }, fixtureContext())
    expect(out.result.ok).toBe(true)
    expect(out.chart).toBeNull()
    expect(out.result.rows).toHaveLength(2)
    const net = expectedNet()
    expect(out.result.facts).toEqual({
      goals: 2,
      by_status: { Behind: 1, 'On track': 1 },
      total_saved: 28500,
      total_target: 36000,
      needed_per_month_total: 944.44,
      // Trip to Japan flat in September, Emergency fund up 800
      saved_this_month: 800,
      average_monthly_net: net,
      can_fund: net >= 944.44 ? 'yes' : 'no'
    })
  })

  it('reports one goal by name', () => {
    const out = runGoals({ goal: 'trip to japan', view: 'status', chart: 'auto' }, fixtureContext())
    expect(out.result.facts).toMatchObject({
      goal: 'Trip to Japan',
      saved: 2500,
      target: 6000,
      remaining: 3500,
      percent_complete: 41.7,
      status: 'Behind',
      needed_per_month: 500,
      target_date: '2027-03-31',
      projected_date: '2027-04-24'
    })
  })

  it('fails on an unknown goal with the real names', () => {
    const out = runGoals({ goal: 'Car', view: 'status', chart: 'auto' }, fixtureContext())
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toMatch(/Trip to Japan, Emergency fund/)
  })

  it('says so when there are no goals', () => {
    const db = fixtureDb()
    db.exec('DELETE FROM temp.goals; DELETE FROM temp.goal_history')
    const out = runGoals({ goal: null, view: 'status', chart: 'auto' }, fixtureContext(db))
    expect(out.result).toMatchObject({ ok: true, notes: ['The user has no active savings goals.'] })
    expect(out.result.rows).toBeUndefined()
  })

  it('walks one goal month by month', () => {
    const out = runGoals(
      { goal: 'Trip to Japan', view: 'history', chart: 'auto' },
      fixtureContext()
    )
    expect(out.result.rows).toEqual([
      ['2026-04', 'Trip to Japan', 500, null],
      ['2026-05', 'Trip to Japan', 1000, 500],
      ['2026-06', 'Trip to Japan', 1500, 500],
      ['2026-07', 'Trip to Japan', 2000, 500],
      ['2026-08', 'Trip to Japan', 2500, 500],
      ['2026-09', 'Trip to Japan', 2500, 0]
    ])
    expect(out.result.facts).toEqual({
      goal: 'Trip to Japan',
      average_monthly_contribution: 500,
      best_month: { month: '2026-05', contributed: 500 },
      contributed_this_month_so_far: 0
    })
    expect(out.chart).toMatchObject({ type: 'line', x: 'month', series: ['saved'], group: null })
  })

  it('sums contributions across goals and groups the chart by goal', () => {
    const out = runGoals({ goal: null, view: 'history', chart: 'auto' }, fixtureContext())
    expect(out.result.rows).toHaveLength(12)
    expect(out.result.facts).toEqual({
      average_monthly_contribution: 1300,
      best_month: { month: '2026-05', contributed: 1300 },
      contributed_this_month_so_far: 800
    })
    expect(out.chart).toMatchObject({ group: 'goal' })
    const none = runGoals({ goal: null, view: 'history', chart: 'none' }, fixtureContext())
    expect(none.chart).toBeNull()
  })
})

describe('goals with spending in another currency', () => {
  it('funds from the goals own currency only', () => {
    const db = fixtureDb()
    addEuroCard(db, [
      { day: '2026-06-10', amount: -5000, description: 'HOTEL LUTETIA', category: null }
    ])
    const out = runGoals({ goal: null, view: 'status', chart: 'auto' }, fixtureContext(db))
    expect(out.result.facts).toMatchObject({ average_monthly_net: expectedNet() })
    expect(out.result.notes).toContain(
      'Only USD amounts are counted; EUR was left out, since currencies are never added together.'
    )
  })
})
