import { describe, it, expect } from 'vitest'
import type { ChartSpec } from '../../shared/chat'
import { MAX_CHART_SERIES, chartCallNote, prepareChart, resolveCurrency } from './chart-tool'

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
    group: null,
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

// the shape the model's natural GROUP BY produces: one row per x per group,
// pivoted on the column the model NAMES in spec.group — stated intent, no
// value-scanning guesswork
describe('prepareChart: group pivots', () => {
  const BY_CATEGORY = {
    columns: ['month', 'category', 'spending'],
    rows: [
      ['2026-05', 'Dining', 120],
      ['2026-05', 'Groceries', 80],
      ['2026-06', 'Dining', 95]
    ]
  }

  it('pivots on the named group column, one series per group value', () => {
    expect(prepareChart(spec({ group: 'category' }), BY_CATEGORY)).toEqual({
      ok: true,
      data: {
        columns: ['month', 'Dining', 'Groceries'],
        rows: [
          ['2026-05', 120, 80],
          ['2026-06', 95, null] // no Groceries row for June: a gap, never a fabricated 0
        ]
      },
      series: ['Dining', 'Groceries']
    })
  })

  it('labels a NULL group (uncategorized rows) rather than dropping it', () => {
    const withNullGroup = {
      columns: ['month', 'category', 'spending'],
      rows: [
        ['2026-05', 'Dining', 120],
        ['2026-05', null, 33]
      ]
    }
    const result = prepareChart(spec({ group: 'category' }), withNullGroup)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.series).toEqual(['Dining', '(none)'])
  })

  it('refuses more groups than a chart can hold, naming the fix', () => {
    const many = {
      columns: ['month', 'category', 'spending'],
      rows: Array.from({ length: MAX_CHART_SERIES + 1 }, (_, i) => ['2026-05', `Cat ${i}`, i + 1])
    }
    const result = prepareChart(spec({ group: 'category' }), many)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(`${MAX_CHART_SERIES + 1} distinct values`)
      expect(result.error).toContain('top')
    }
  })

  it('holds group to exactly one series: the measure', () => {
    const twoMeasures = {
      columns: ['month', 'category', 'spending', 'income'],
      rows: [['2026-05', 'Dining', 120, 0]]
    }
    const result = prepareChart(
      spec({ group: 'category', series: ['spending', 'income'] }),
      twoMeasures
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('one measure')
  })

  it('rejects group doubling as x', () => {
    const result = prepareChart(spec({ x: 'category', group: 'category' }), BY_CATEGORY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('different columns')
  })

  it('names a group column that is not in the result', () => {
    const result = prepareChart(spec({ group: 'categry' }), BY_CATEGORY)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('"categry"')
      expect(result.error).toContain('month, category, spending')
    }
  })

  it('keeps group out of stat and pie', () => {
    for (const type of ['stat', 'pie'] as const) {
      const result = prepareChart(spec({ type, group: 'category' }), BY_CATEGORY)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('line and bar')
    }
  })

  it('treats a missing group field (pre-group persisted parts) as no group', () => {
    const legacy = { ...spec(), group: undefined } as unknown as ChartSpec
    expect(prepareChart(legacy, RESULT).ok).toBe(true)
  })

  // the two spellings the old heuristics absorbed must now bounce back as
  // corrective errors that point at group, not draw by guesswork
  it('answers series naming group VALUES with a plain missing-column error', () => {
    const result = prepareChart(spec({ x: 'month', series: ['Dining', 'Groceries'] }), BY_CATEGORY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('"Dining"')
  })

  it('answers a repeated x without group by naming group as the fix', () => {
    const result = prepareChart(spec(), BY_CATEGORY)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('repeats across rows')
      expect(result.error).toContain('group')
    }
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

// the note appended to every successful query result: exact column names
// always, the group recipe only when the long form is certain — a hint that
// guesses wrong teaches a wrong call, so every ambiguous shape stays silent
describe('chartCallNote', () => {
  const LONG_FORM = [
    ['2026-05', 'Dining', 120],
    ['2026-05', 'Groceries', 80],
    ['2026-06', 'Dining', 95],
    ['2026-06', 'Groceries', 60]
  ]

  it('always names the exact legal columns', () => {
    const note = chartCallNote(['month', 'spending'], [['2026-05', 120]])
    expect(note).toContain('exact names: month, spending')
    expect(note).not.toContain('one row per')
  })

  it('states the group recipe for the canonical long form', () => {
    const note = chartCallNote(['month', 'category', 'spending'], LONG_FORM)
    expect(note).toContain('one row per month per category')
    expect(note).toContain('the other as group')
    expect(note).toContain('["spending"]')
  })

  it('treats a NULL label (uncategorized rows) as a real group value', () => {
    const rows = [
      ['2026-05', 'Dining', 120],
      ['2026-05', null, 33],
      ['2026-06', 'Dining', 95],
      ['2026-06', null, 21]
    ]
    expect(chartCallNote(['month', 'category', 'spending'], rows)).toContain('one row per')
  })

  it('warns when a label column would blow the series cap', () => {
    const rows = ['2026-05', '2026-06'].flatMap((month) =>
      Array.from({ length: MAX_CHART_SERIES + 1 }, (_, i) => [month, `Cat ${i}`, i + 1])
    )
    const note = chartCallNote(['month', 'category', 'spending'], rows)
    expect(note).toContain(`"category" has ${MAX_CHART_SERIES + 1} distinct values`)
    expect(note).toContain(`top ${MAX_CHART_SERIES}`)
  })

  it('stays silent when two columns are numeric (day-number comparisons)', () => {
    const rows = [
      [1, '2026-06', 62.1],
      [1, '2026-07', 15.44],
      [2, '2026-06', 8.0],
      [2, '2026-07', 12.5]
    ]
    expect(chartCallNote(['day', 'month', 'spending'], rows)).not.toContain('one row per')
  })

  it('stays silent on a listing whose label pairs repeat', () => {
    const rows = [
      ['2026-05', 'Starbucks', -6.2],
      ['2026-05', 'Starbucks', -5.8],
      ['2026-06', 'Starbucks', -6.2]
    ]
    expect(chartCallNote(['month', 'description', 'amount'], rows)).not.toContain('one row per')
  })

  it('stays silent when a label never repeats (a direct draw already works)', () => {
    const rows = [
      ['2026-05', 'Dining', 120],
      ['2026-06', 'Groceries', 80],
      ['2026-07', 'Transport', 44]
    ]
    expect(chartCallNote(['month', 'category', 'spending'], rows)).not.toContain('one row per')
  })

  it('never hints outside exactly three columns', () => {
    const four = [
      ['2026-05', 'Dining', 120, 200],
      ['2026-05', 'Groceries', 80, 200],
      ['2026-06', 'Dining', 95, 95]
    ]
    expect(chartCallNote(['month', 'category', 'spending', 'total'], four)).not.toContain(
      'one row per'
    )
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
