import { describe, it, expect } from 'vitest'
import type { ChartSpec } from '../../shared/chat'
import { resolveCurrency, validateChartCall } from './chart-tool'

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

describe('validateChartCall', () => {
  it('accepts a series over the last result', () => {
    expect(validateChartCall(spec(), RESULT)).toEqual({ ok: true })
  })

  it('tells the model to query first when there is no result yet', () => {
    expect(validateChartCall(spec(), null)).toEqual({
      ok: false,
      error: 'There is no query result to chart; run query first.'
    })
  })

  it('rejects an empty result rather than charting nothing', () => {
    const result = validateChartCall(spec(), { columns: ['month'], rows: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no rows')
  })

  it('names the missing series column and lists what exists', () => {
    const result = validateChartCall(spec({ series: ['spend'] }), RESULT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('"spend"')
    expect(result.error).toContain('month, spending, income')
  })

  it('requires x to be a result column for axis charts', () => {
    const result = validateChartCall(spec({ x: 'Month' }), RESULT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('"Month"')
  })

  it('rejects x doubling as a series column', () => {
    const result = validateChartCall(spec({ x: 'spending' }), RESULT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('different columns')
  })

  it('ignores x for stat, where the grammar forces one anyway', () => {
    expect(validateChartCall(spec({ type: 'stat', x: 'anything' }), RESULT)).toEqual({ ok: true })
  })

  it('holds pie to exactly one series', () => {
    const result = validateChartCall(spec({ type: 'pie', series: ['spending', 'income'] }), RESULT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('exactly one')
  })

  it('holds stat to a value column plus at most one change column', () => {
    expect(
      validateChartCall(spec({ type: 'stat', series: ['spending', 'income'] }), RESULT)
    ).toEqual({ ok: true })
    const over = validateChartCall(
      spec({ type: 'stat', series: ['spending', 'income', 'month'] }),
      RESULT
    )
    expect(over.ok).toBe(false)
  })

  it('rejects a text column as a series', () => {
    const result = validateChartCall(spec({ x: 'spending', series: ['month'] }), RESULT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not numeric')
  })

  it('rejects long-form data (repeated x values) and points at the pivot recipe', () => {
    const longForm = {
      columns: ['month', 'category', 'spending'],
      rows: [
        ['2026-05', 'Dining', 120],
        ['2026-05', 'Groceries', 80],
        ['2026-06', 'Dining', 95]
      ]
    }
    const result = validateChartCall(spec({ series: ['spending'] }), longForm)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('repeats across rows')
    expect(result.error).toContain('SUM(CASE WHEN')
    expect(result.error).toContain('call chart again')
  })

  it('accepts several series columns for a comparison', () => {
    const wide = {
      columns: ['day', 'dining', 'groceries'],
      rows: [
        ['2026-06-01', 12.5, 40],
        ['2026-06-02', 0, 22.75]
      ]
    }
    expect(validateChartCall(spec({ x: 'day', series: ['dining', 'groceries'] }), wide)).toEqual({
      ok: true
    })
  })

  it('tolerates NULL cells in a series (a bucket with no data)', () => {
    const withNull = {
      columns: ['month', 'spending'],
      rows: [
        ['2026-05', null],
        ['2026-06', 9]
      ]
    }
    expect(validateChartCall(spec({ series: ['spending'] }), withNull)).toEqual({ ok: true })
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
