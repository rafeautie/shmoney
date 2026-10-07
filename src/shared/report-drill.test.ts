import { describe, expect, it } from 'vitest'
import { budgetDrillFilters, drillFilters } from './report-drill'
import {
  DEFAULT_REPORT_FILTERS,
  previousPeriod,
  type ReportFilters,
  type WidgetConfig
} from './reports'

const sec = (...args: [number, number, number, number?, number?, number?]): number =>
  Math.floor(new Date(...args).getTime() / 1000)

// Oct 3 2026, local midnight, the stable "today" the renderer resolves against
const NOW = sec(2026, 9, 3)

function config(query: Partial<WidgetConfig['query']>, overrides = {}): WidgetConfig {
  return {
    query: {
      source: 'transactions',
      measure: 'expense',
      groupBy: 'none',
      timeGrain: 'month',
      cumulative: false,
      ...query
    },
    filters: { mode: 'inherit', overrides }
  }
}

const report: ReportFilters = DEFAULT_REPORT_FILTERS

describe('drillFilters', () => {
  it('narrows the date range to the clicked bucket', () => {
    const f = drillFilters(config({}), report, { bucket: '2026-03' }, NOW)!
    expect(f.dateRange).toEqual({
      kind: 'absolute',
      start: sec(2026, 2, 1),
      end: sec(2026, 2, 31, 23, 59, 59)
    })
    expect(f.direction).toBe('expense')
    expect(f.includeTransfers).toBe(false)
  })

  it('clips the bucket to the effective range', () => {
    const own = { dateRange: { kind: 'absolute', start: sec(2026, 2, 10), end: sec(2026, 2, 20) } }
    const f = drillFilters(config({}, own), report, { bucket: '2026-03' }, NOW)!
    expect(f.dateRange).toEqual({
      kind: 'absolute',
      start: sec(2026, 2, 10),
      end: sec(2026, 2, 20)
    })
  })

  it('spans from the first bucket on cumulative charts', () => {
    const f = drillFilters(
      config({ cumulative: true, timeGrain: 'quarter' }),
      report,
      { bucket: '2026-Q2', fromBucket: '2026-Q1' },
      NOW
    )!
    expect(f.dateRange).toEqual({
      kind: 'absolute',
      start: sec(2026, 0, 1),
      end: sec(2026, 5, 30, 23, 59, 59)
    })
  })

  it('maps the clicked group onto its filter field', () => {
    const byCategory = drillFilters(
      config({ groupBy: 'category', timeGrain: 'none' }),
      { ...report, categoryIds: [1, 2, 3], includeUncategorized: true },
      { groupIds: [2] },
      NOW
    )!
    expect(byCategory.categoryIds).toEqual([2])
    expect(byCategory.includeUncategorized).toBeUndefined()
    expect(byCategory.dateRange).toEqual(report.dateRange)

    const uncategorized = drillFilters(
      config({ groupBy: 'category', timeGrain: 'none' }),
      report,
      { groupIds: [null] },
      NOW
    )!
    expect(uncategorized.categoryIds).toBeUndefined()
    expect(uncategorized.includeUncategorized).toBe(true)

    const other = drillFilters(
      config({ groupBy: 'account', timeGrain: 'none' }),
      report,
      { groupIds: [4, 5] },
      NOW
    )!
    expect(other.accountIds).toEqual([4, 5])
  })

  it('drills an ungrouped mark to the ungrouped categories and uncategorized rows', () => {
    const categories = [
      { id: 1, groupId: 10, systemKey: null },
      { id: 2, groupId: null, systemKey: null },
      { id: 3, groupId: null, systemKey: 'transfers' },
      { id: 4, groupId: null, systemKey: 'opening' },
      { id: 5, groupId: 20, systemKey: null }
    ]
    const byGroup = config({ groupBy: 'categoryGroup' })
    const ungrouped = drillFilters(byGroup, report, { groupIds: [null] }, NOW, categories)!
    expect(ungrouped).toMatchObject({ categoryIds: [2], includeUncategorized: true })
    expect(ungrouped.categoryGroupIds).toBeUndefined()

    // an Other rollup mixing a group with the ungrouped ones; transfers opted in
    const withTransfers = { ...report, includeTransfers: true }
    expect(
      drillFilters(byGroup, withTransfers, { groupIds: [10, null] }, NOW, categories)
    ).toMatchObject({ categoryIds: [1, 2, 3], includeUncategorized: true })

    // before the categories load there is no answer yet
    expect(drillFilters(byGroup, report, { groupIds: [null] }, NOW)).toBeNull()
  })

  it('has no answer for goal sources', () => {
    expect(drillFilters(config({ source: 'goals' }), report, { bucket: '2026-03' }, NOW)).toBeNull()
  })

  it('keeps an explicit direction and passes sums through unsigned', () => {
    expect(drillFilters(config({}), { ...report, direction: 'income' }, {}, NOW)!.direction).toBe(
      'income'
    )
    expect(drillFilters(config({ measure: 'sum' }), report, {}, NOW)!.direction).toBe('all')
  })
})

describe('previousPeriod', () => {
  it('compares a to-date range with the same point one length back', () => {
    expect(
      previousPeriod({ kind: 'relative', unit: 'month', count: 1, includeCurrent: true }, NOW)
    ).toEqual({ start: sec(2026, 8, 1), end: sec(2026, 8, 3, 23, 59, 59), label: 'previous month' })
  })

  it('shifts completed units back by the count', () => {
    expect(
      previousPeriod({ kind: 'relative', unit: 'month', count: 3, includeCurrent: false }, NOW)
    ).toEqual({
      start: sec(2026, 3, 1),
      end: sec(2026, 5, 30, 23, 59, 59),
      label: 'previous 3 months'
    })
  })

  it('shifts whole-month absolute ranges by months', () => {
    expect(
      previousPeriod(
        { kind: 'absolute', start: sec(2026, 1, 1), end: sec(2026, 1, 28, 23, 59, 59) },
        NOW
      )
    ).toEqual({
      start: sec(2026, 0, 1),
      end: sec(2026, 0, 31, 23, 59, 59),
      label: 'previous month'
    })
  })

  it('shifts other absolute ranges by their length', () => {
    const start = sec(2026, 4, 10)
    const end = sec(2026, 4, 19, 23, 59, 59)
    expect(previousPeriod({ kind: 'absolute', start, end }, NOW)).toEqual({
      start: start - (end - start + 1),
      end: start - 1,
      label: 'previous period'
    })
  })

  it('has nothing before all time', () => {
    expect(previousPeriod({ kind: 'all' }, NOW)).toBeNull()
  })
})

describe('drillFilters with an empty target', () => {
  it('opens the widget effective filters unchanged, as a stat tile does', () => {
    const f = drillFilters(config({ measure: 'sum' }), report, {}, NOW)!
    expect(f).toEqual({ ...report, direction: 'all' })
  })
})

describe('budgetDrillFilters', () => {
  it('spans the month and counts outflows in the envelopes, like the budget', () => {
    expect(budgetDrillFilters('2026-02', [4, 9])).toEqual({
      dateRange: { kind: 'absolute', start: sec(2026, 1, 1), end: sec(2026, 1, 28, 23, 59, 59) },
      direction: 'expense',
      includePending: true,
      includeTransfers: true,
      categoryIds: [4, 9]
    })
  })
})
