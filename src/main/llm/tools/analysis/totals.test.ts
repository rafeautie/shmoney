import { describe, expect, it } from 'vitest'
import { fixtureContext, fixtureDb, fixtureTransactions, MONTHS, noon } from './test-fixture'
import { runTotals } from './totals'
import { round2 } from './common'

const txs = fixtureTransactions().filter((t) => t.category !== '🔄 Transfers')
type Tx = (typeof txs)[number]
const spent = (pred: (t: Tx) => boolean): number =>
  txs.filter((t) => t.amount < 0 && pred(t)).reduce((s, t) => s - t.amount, 0)
const earned = (pred: (t: Tx) => boolean): number =>
  txs.filter((t) => t.amount > 0 && pred(t)).reduce((s, t) => s + t.amount, 0)
const inMonth =
  (month: string) =>
  (t: Tx): boolean =>
    t.day.startsWith(month)
const between =
  (start: string, end: string) =>
  (t: Tx): boolean =>
    t.day >= start && t.day <= end

const args = (over: Record<string, unknown>): Record<string, unknown> => ({
  measure: 'spending',
  by: 'none',
  split: 'none',
  period: 'all',
  compare_to: null,
  category: null,
  account: null,
  search: null,
  chart: 'auto',
  ...over
})

describe('totals', () => {
  const ctx = fixtureContext()

  it('averages, highs and lows over complete months only', () => {
    const { result, chart } = runTotals(args({ by: 'month' }), ctx)
    const complete = MONTHS.slice(1, 12)
    const values = complete.map((m) => ({ m, v: spent(inMonth(m)) }))
    const high = values.reduce((a, b) => (b.v > a.v ? b : a))
    const low = values.reduce((a, b) => (b.v < a.v ? b : a))
    const f = result.facts!
    expect(f.total_spending).toBeCloseTo(
      spent(() => true),
      2
    )
    expect(f.complete_months).toBe(11)
    expect(f.average_per_complete_month).toBeCloseTo(
      values.reduce((s, x) => s + x.v, 0) / values.length,
      2
    )
    expect(f.highest_complete_month).toEqual({ month: '2026-07', spending: round2(high.v) })
    expect(high.m).toBe('2026-07')
    expect(f.lowest_complete_month).toMatchObject({ month: low.m })
    expect(low.m).not.toBe('2025-09')
    expect(f['2026-09_so_far']).toBeCloseTo(spent(inMonth('2026-09')), 2)
    expect(result.columns).toEqual(['month', 'spending'])
    expect(result.rows!.map((r) => r[0])).toEqual(MONTHS)
    expect(chart).toMatchObject({ type: 'line', x: 'month', series: ['spending'], group: null })
  })

  it('aligns this month against the same days of last month', () => {
    const { result, chart } = runTotals(args({ period: 'this_month', compare_to: 'previous' }), ctx)
    const f = result.facts!
    const cur = spent(between('2026-09-01', '2026-09-24'))
    const prev = spent(between('2026-08-01', '2026-08-24'))
    expect(f.total_spending).toBeCloseTo(cur, 2)
    expect(f.previous_total_spending).toBeCloseTo(prev, 2)
    expect(f.change).toBeCloseTo(cur - prev, 2)
    expect(f.previous_whole_period_total_spending).toBeCloseTo(spent(inMonth('2026-08')), 2)
    expect(result.comparedWith).toBe('2026-08 through 08-24')
    expect(result.notes).toContain(
      'Compared over the same days: 2026-09 so far vs 2026-08 through 08-24.'
    )
    expect(chart).toBeNull()
  })

  it('finds Shopping as the driver of July against June', () => {
    const { result, chart } = runTotals(
      args({ period: '2026-07', by: 'category', compare_to: 'previous' }),
      ctx
    )
    const f = result.facts!
    const change = spent(inMonth('2026-07')) - spent(inMonth('2026-06'))
    expect(result.comparedWith).toBe('2026-06')
    expect(f.change).toBeCloseTo(change, 2)
    const drivers = f.drivers as { name: string; change: number; share_of_change_percent: number }[]
    expect(drivers[0]).toMatchObject({ name: '🛍️ Shopping', change: 600 })
    expect(drivers[0].share_of_change_percent).toBeCloseTo((600 / change) * 100, 1)
    expect(result.columns).toEqual(['category', 'spending', 'previous_spending', 'change'])
    expect(result.rows![0][0]).toBe('🛍️ Shopping')
    expect(chart).toMatchObject({ type: 'bar', series: ['spending', 'previous_spending'] })
  })

  it('searches and says what matched', () => {
    const { result } = runTotals(args({ search: 'coffee' }), ctx)
    expect(result.facts!.total_spending).toBeCloseTo(
      spent((t) => t.description.includes('COFFEE')),
      2
    )
    expect(result.notes!.join(' ')).toMatch(/'coffee' matched Blue Bottle Coffee \(\d+\)/)
  })

  it('reports net with the savings rate', () => {
    const { result } = runTotals(args({ measure: 'net', period: 'last_3_months' }), ctx)
    const window = between('2026-06-01', '2026-08-31')
    const income = earned(window)
    const spending = spent(window)
    const f = result.facts!
    expect(f.total_net).toBeCloseTo(income - spending, 2)
    expect(f.total_income).toBeCloseTo(income, 2)
    expect(f.total_spending).toBeCloseTo(spending, 2)
    expect(f.savings_rate_percent).toBeCloseTo(((income - spending) / income) * 100, 2)
  })

  it('answers a period with no data with zero and the coverage note', () => {
    const { result, chart } = runTotals(args({ period: '2025-03', by: 'month' }), ctx)
    expect(result.ok).toBe(true)
    expect(result.facts).toEqual({ total_spending: 0 })
    expect(result.notes![0]).toMatch(/^No transactions in 2025-03; the data runs 2025-09-10/)
    expect(chart).toBeNull()
  })

  it('returns long-form rows for a split, grouped in the chart', () => {
    const { result, chart } = runTotals(
      args({ by: 'month', split: 'category', period: 'last_3_months' }),
      ctx
    )
    expect(result.columns).toEqual(['month', 'category', 'spending'])
    const july = result.rows!.filter((r) => r[0] === '2026-07')
    expect(july.reduce((s, r) => s + (r[2] as number), 0)).toBeCloseTo(spent(inMonth('2026-07')), 2)
    expect(chart).toMatchObject({
      type: 'line',
      x: 'month',
      series: ['spending'],
      group: 'category'
    })
  })

  it('treats a split without a by as the breakdown', () => {
    const { result } = runTotals(args({ split: 'category', period: '2026-07' }), ctx)
    expect(result.columns).toEqual(['category', 'spending'])
  })

  it('orders weekdays Monday to Sunday', () => {
    const { result } = runTotals(args({ by: 'weekday' }), ctx)
    expect(result.rows!.map((r) => r[0])).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday'
    ])
    const weekend = spent((t) => [0, 6].includes(new Date(`${t.day}T12:00:00Z`).getUTCDay()))
    const perDay = result.facts!.per_day as Record<string, number | string>
    expect(perDay.per_weekend_day).toBeCloseTo(weekend / 2, 2)
    expect(perDay.per_weekday).toBeCloseTo((spent(() => true) - weekend) / 5, 2)
    expect(perDay.more_per_day_on).toBe(
      weekend / 2 > (spent(() => true) - weekend) / 5 ? 'weekends' : 'weekdays'
    )
    // the verdict leads, so it is the nearest figure the model reads
    expect(Object.keys(result.facts!)[0]).toBe('per_day')
  })

  it('folds split values past the top 8 into Other without losing money', () => {
    const { result } = runTotals(args({ by: 'month', split: 'merchant' }), ctx)
    const merchants = new Set(result.rows!.map((r) => r[1]))
    expect(merchants.has('Other')).toBe(true)
    expect(merchants.size).toBe(9)
    for (const month of MONTHS) {
      const sum = result
        .rows!.filter((r) => r[0] === month)
        .reduce((s, r) => s + (r[2] as number), 0)
      expect(sum).toBeCloseTo(spent(inMonth(month)), 2)
    }
  })

  it('folds breakdown groups past the top 12 into Other without losing money', () => {
    const db = fixtureDb()
    const names = [
      'ALPHA',
      'BRAVO',
      'CHARLIE',
      'DELTA',
      'ECHO',
      'FOXTROT',
      'GOLF',
      'HOTEL',
      'INDIA',
      'JULIETT',
      'KILO',
      'LIMA',
      'MIKE',
      'NOVEMBER',
      'OSCAR'
    ]
    const insert = db.prepare(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
       VALUES (3, ?, ?, ?, ?, 0, ?, NULL)`
    )
    names.forEach((n, i) =>
      insert.run(`x${i}`, noon('2026-08-10'), -(i + 1) * 1000, `${n} STORE`, noon('2026-08-10'))
    )
    const { result } = runTotals(args({ by: 'merchant', period: '2026-08' }), fixtureContext(db))
    const expected = spent(inMonth('2026-08')) + names.reduce((s, _, i) => s + i + 1, 0)
    expect(result.rows).toHaveLength(13)
    expect(result.rows!.at(-1)![0]).toBe('Other')
    expect(result.facts!.total_spending).toBeCloseTo(expected, 2)
    expect(result.rows!.reduce((s, r) => s + (r[1] as number), 0)).toBeCloseTo(expected, 2)
    expect(result.facts!.top_merchant).toMatchObject({ spending: 2000 })
  })

  it('never adds different currencies together', () => {
    const db = fixtureDb()
    db.exec(
      "INSERT INTO main.accounts (id, name, currency, balance, available_balance, balance_date) VALUES (4, 'Euro Card', 'EUR', 0, NULL, 0)"
    )
    db.prepare(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
       VALUES (4, 'eur1', ?, -50000, 'CAFE DE FLORE', 0, ?, NULL)`
    ).run(noon('2026-08-05'), noon('2026-08-05'))
    const { result, chart } = runTotals(args({ period: '2026-08' }), fixtureContext(db))
    expect(result.facts!.total_spending_EUR).toBe(50)
    expect(result.facts!.total_spending_USD).toBeCloseTo(spent(inMonth('2026-08')), 2)
    expect(result.columns![0]).toBe('currency')
    expect(result.notes).toContain('Amounts in different currencies are never added together.')
    expect(chart).toBeNull()
  })

  it('adds per-month averages when the windows differ in length', () => {
    const { result } = runTotals(
      args({ period: 'last_6_months', compare_to: 'last_3_months' }),
      ctx
    )
    const f = result.facts!
    expect(f.average_per_month).toBeCloseTo(spent(between('2026-03-01', '2026-08-31')) / 6, 2)
    expect(f.previous_average_per_month).toBeCloseTo(
      spent(between('2026-06-01', '2026-08-31')) / 3,
      2
    )
  })

  it('leaves a longer comparison whole against a partial month, with per-month averages', () => {
    const { result } = runTotals(args({ period: 'this_month', compare_to: 'last_3_months' }), ctx)
    const f = result.facts!
    const cur = spent(between('2026-09-01', '2026-09-24'))
    const prev = spent(between('2026-06-01', '2026-08-31'))
    expect(f.previous_total_spending).toBeCloseTo(prev, 2)
    expect(f).not.toHaveProperty('previous_whole_period_total_spending')
    expect(f.average_per_month).toBeCloseTo(cur, 2)
    expect(f.previous_average_per_month).toBeCloseTo(prev / 3, 2)
    expect(result.comparedWith).toBe('2026-06 to 2026-08 (3 complete months)')
    expect(result.notes!.some((n) => n.startsWith('Compared over the same days'))).toBe(false)
  })

  it('refuses a period that has not started instead of answering 0', () => {
    const { result } = runTotals(args({ period: '2026-12' }), ctx)
    expect(result.ok).toBe(false)
    expect(result.error).toBe("2026-12 hasn't started yet; the data runs to 2026-09-20.")
  })

  it('names no top group for net, where it would be the income', () => {
    const { result } = runTotals(args({ measure: 'net', by: 'category', period: '2026-08' }), ctx)
    expect(result.facts!.total_net).toBeCloseTo(
      earned(inMonth('2026-08')) - spent(inMonth('2026-08')),
      2
    )
    expect(result.facts).not.toHaveProperty('top_category')
    const split = runTotals(
      args({ measure: 'net', by: 'month', split: 'category', period: 'last_3_months' }),
      ctx
    )
    expect(split.result.facts).not.toHaveProperty('top_category')
  })

  it('keeps net split cells that cancel to zero in the income and spending totals', () => {
    const db = fixtureDb()
    db.prepare(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
       VALUES (3, 'refund', ?, 45000, 'AMAZON.COM REFUND', 0, ?,
         (SELECT id FROM main.categories WHERE name = '🛍️ Shopping'))`
    ).run(noon('2026-08-20'), noon('2026-08-20'))
    const { result } = runTotals(
      args({ measure: 'net', by: 'month', split: 'category', period: '2026-08' }),
      fixtureContext(db)
    )
    const f = result.facts!
    expect(f.total_income).toBeCloseTo(earned(inMonth('2026-08')) + 45, 2)
    expect(f.total_spending).toBeCloseTo(spent(inMonth('2026-08')), 2)
    expect(result.rows).toContainEqual(['2026-08', '🛍️ Shopping', 0])
  })

  it('fails with the period error', () => {
    const { result } = runTotals(args({ period: 'someday' }), ctx)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Unknown period/)
  })
})

describe('uncovered comparisons', () => {
  it('reports a comparison the data does not cover as unavailable, with no previous figures', () => {
    const { result } = runTotals(
      {
        measure: 'spending',
        by: 'none',
        split: 'none',
        period: 'this_year',
        compare_to: 'last_year',
        category: null,
        account: null,
        search: null,
        chart: 'auto'
      },
      fixtureContext()
    )
    expect(result.ok).toBe(true)
    expect(Object.keys(result.facts!)[0]).toBe('comparison_unavailable')
    expect(result.facts!.comparison_unavailable).toContain('The data starts 2025-09-10')
    expect(Object.keys(result.facts!).some((k) => k.startsWith('previous'))).toBe(false)
    expect(result.comparedWith).toBeUndefined()
  })
})
