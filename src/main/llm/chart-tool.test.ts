import { describe, it, expect } from 'vitest'
import type { ChartSpec } from '../../shared/chat'
import { MAX_CHART_SERIES, prepareChart, resolveCurrency } from './chart-tool'

const RESULT = {
  columns: ['month', 'spending', 'income'],
  rows: [
    ['2026-05', 120.5, 300],
    ['2026-06', 98, 300]
  ]
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    type: 'line',
    title: 'Spending by month',
    x: 'month',
    series: ['spending'],
    ...overrides
  }
}

describe('prepareChart: direct draws', () => {
  it('passes a wide result through whole, series as asked', () => {
    expect(prepareChart(spec(), RESULT)).toEqual({
      ok: true,
      data: { columns: RESULT.columns, rows: RESULT.rows },
      series: ['spending']
    })
  })

  it('tells the model to query first when there is no result yet', () => {
    expect(prepareChart(spec(), null)).toEqual({
      ok: false,
      error:
        'No query has run in this reply yet; results from earlier replies expire. Run the query now, then call chart again.'
    })
  })

  it('rejects an empty result rather than charting nothing', () => {
    const result = prepareChart(spec(), { columns: ['month'], rows: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no rows')
  })

  it('names the missing series column and lists what exists', () => {
    const result = prepareChart(spec({ series: ['spend'] }), RESULT)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('"spend"')
      expect(result.error).toContain('month, spending, income')
    }
  })

  it('requires x to be a result column for axis charts', () => {
    const result = prepareChart(spec({ x: 'Month' }), RESULT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('"Month"')
  })

  it('rejects x doubling as a series column', () => {
    const result = prepareChart(spec({ x: 'spending' }), RESULT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('different columns')
  })

  it('ignores x for stat, where the grammar forces one anyway', () => {
    expect(prepareChart(spec({ type: 'stat', x: 'anything' }), RESULT).ok).toBe(true)
  })

  it('holds pie to exactly one series', () => {
    const result = prepareChart(spec({ type: 'pie', series: ['spending', 'income'] }), RESULT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('exactly one')
  })

  it('holds stat to a value column plus at most one change column', () => {
    expect(prepareChart(spec({ type: 'stat', series: ['spending', 'income'] }), RESULT).ok).toBe(
      true
    )
    expect(
      prepareChart(spec({ type: 'stat', series: ['spending', 'income', 'month'] }), RESULT).ok
    ).toBe(false)
  })

  it('rejects a text column as a series', () => {
    const result = prepareChart(spec({ x: 'spending', series: ['month'] }), RESULT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not numeric')
  })

  it('rejects a series that is NULL in every row rather than drawing a blank card', () => {
    const noMatches = { columns: ['spending'], rows: [[null]] }
    const result = prepareChart(spec({ type: 'stat', x: 'spending' }), noMatches)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no transactions matched')
  })

  it('accepts several series columns for a comparison', () => {
    const wide = {
      columns: ['day', 'dining', 'groceries'],
      rows: [
        ['2026-06-01', 12.5, 40],
        ['2026-06-02', 0, 22.75]
      ]
    }
    expect(prepareChart(spec({ x: 'day', series: ['dining', 'groceries'] }), wide).ok).toBe(true)
  })

  it('tolerates NULL cells in a series (a bucket with no data)', () => {
    const withNull = {
      columns: ['month', 'spending'],
      rows: [
        ['2026-05', null],
        ['2026-06', 9]
      ]
    }
    expect(prepareChart(spec(), withNull).ok).toBe(true)
  })
})

// the shape the model's natural GROUP BY produces: one row per bucket per
// group. Both long-form spellings must DRAW, never bounce back as an error
// for the model to fix with pivot SQL it cannot reliably write.
describe('prepareChart: long-form pivots', () => {
  const LONG = {
    columns: ['day', 'month', 'spending'],
    rows: [
      [1, '2026-06', 12.5],
      [1, '2026-07', 40],
      [2, '2026-06', 8]
    ]
  }

  // REGRESSION: asked for two months of daily spending as two lines, the
  // model queried long-form and passed the month VALUES as series; this used
  // to be a dead-end "no such column" error
  it('draws series that name VALUES of a group column, one line per value', () => {
    const result = prepareChart(spec({ x: 'day', series: ['2026-06', '2026-07'] }), LONG)
    expect(result).toEqual({
      ok: true,
      data: {
        columns: ['day', '2026-06', '2026-07'],
        rows: [
          [1, 12.5, 40],
          [2, 8, null] // no July row for day 2: a gap, never a fabricated 0
        ]
      },
      series: ['2026-06', '2026-07']
    })
  })

  it('draws only the values asked for, in the order asked', () => {
    const result = prepareChart(spec({ x: 'day', series: ['2026-07'] }), LONG)
    expect(result).toEqual({
      ok: true,
      data: {
        columns: ['day', '2026-07'],
        rows: [
          [1, 40],
          [2, null]
        ]
      },
      series: ['2026-07']
    })
  })

  it('splits a repeated-x result into one line per group value', () => {
    const byCategory = {
      columns: ['month', 'category', 'spending'],
      rows: [
        ['2026-05', 'Dining', 120],
        ['2026-05', 'Groceries', 80],
        ['2026-06', 'Dining', 95]
      ]
    }
    expect(prepareChart(spec({ series: ['spending'] }), byCategory)).toEqual({
      ok: true,
      data: {
        columns: ['month', 'Dining', 'Groceries'],
        rows: [
          ['2026-05', 120, 80],
          ['2026-06', 95, null]
        ]
      },
      series: ['Dining', 'Groceries']
    })
  })

  // REGRESSION (of the old coaching error): grouping by account must key on
  // the account_name column, not assume category
  it('groups a repeated-x result by whatever label column is present', () => {
    const byAccount = {
      columns: ['month', 'account_name', 'spending'],
      rows: [
        ['2026-05', 'Chase Checking', 120],
        ['2026-05', 'Amex Card', 80],
        ['2026-06', 'Chase Checking', 95]
      ]
    }
    const result = prepareChart(spec({ series: ['spending'] }), byAccount)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.series).toEqual(['Chase Checking', 'Amex Card'])
  })

  it('labels a NULL group (uncategorized rows) rather than dropping it', () => {
    const withNullGroup = {
      columns: ['month', 'category', 'spending'],
      rows: [
        ['2026-05', 'Dining', 120],
        ['2026-05', null, 33]
      ]
    }
    const result = prepareChart(spec({ series: ['spending'] }), withNullGroup)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.series).toEqual(['Dining', '(none)'])
  })

  it('refuses more groups than a chart can hold, naming the fix', () => {
    const many = {
      columns: ['month', 'category', 'spending'],
      rows: Array.from({ length: MAX_CHART_SERIES + 1 }, (_, i) => ['2026-05', `Cat ${i}`, i + 1])
    }
    // every x is the same month, so x repeats and the group count overflows
    const result = prepareChart(spec({ series: ['spending'] }), many)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(`${MAX_CHART_SERIES + 1} distinct values`)
      expect(result.error).toContain('top')
    }
  })

  it('reports two candidate group columns instead of guessing', () => {
    const twoLabels = {
      columns: ['month', 'category', 'account_name', 'spending'],
      rows: [
        ['2026-05', 'Dining', 'Chase', 120],
        ['2026-05', 'Groceries', 'Chase', 80]
      ]
    }
    const result = prepareChart(spec({ series: ['spending'] }), twoLabels)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('"category"')
      expect(result.error).toContain('"account_name"')
    }
  })

  it('reports an ambiguous measure when value-series leave several candidates', () => {
    const twoMeasures = {
      columns: ['day', 'month', 'spending', 'income'],
      rows: [
        [1, '2026-06', 12.5, 0],
        [1, '2026-07', 40, 10]
      ]
    }
    const result = prepareChart(spec({ x: 'day', series: ['2026-06', '2026-07'] }), twoMeasures)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no single value column')
  })

  it('still reports a genuine typo as a typo, not as a pivot', () => {
    // 'spend' is no column and no value, so nothing to pivot on
    const result = prepareChart(spec({ series: ['spend'] }), RESULT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('is not in the last query result')
  })

  it('keeps pie out of the pivot: repeated slices are a query problem', () => {
    const repeated = {
      columns: ['category', 'month', 'spending'],
      rows: [
        ['Dining', '2026-05', 120],
        ['Dining', '2026-06', 95]
      ]
    }
    const result = prepareChart(
      spec({ type: 'pie', x: 'category', series: ['spending'] }),
      repeated
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('one row per category')
  })
})

describe('resolveCurrency', () => {
  it('returns the shared currency when every account agrees', () => {
    expect(resolveCurrency([{ currency: 'USD' }, { currency: 'USD' }])).toBe('USD')
  })

  it('returns null for mixed currencies', () => {
    expect(resolveCurrency([{ currency: 'USD' }, { currency: 'EUR' }])).toBeNull()
  })

  it('returns null with no accounts in scope', () => {
    expect(resolveCurrency([])).toBeNull()
  })
})
