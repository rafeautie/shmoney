import { describe, it, expect } from 'vitest'
import { resolveDateWindow } from './resolve-dates-tool'

// a fixed "today" so every window is deterministic; 2026-07-21 is a Tuesday in
// Q3, mid-July, mid-year — every unit has both a partial current period and a
// clean previous one
const TODAY = '2026-07-21'

/** inclusive day span between two 'YYYY-MM-DD' bounds, for the rolling units */
function inclusiveDays(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split('-').map(Number)
  const [ey, em, ed] = endIso.split('-').map(Number)
  return (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000 + 1
}

describe('resolveDateWindow', () => {
  it('resolves the last N calendar months up to today', () => {
    expect(resolveDateWindow({ unit: 'month', count: 3, includeCurrent: true }, TODAY)).toEqual({
      ok: true,
      start: '2026-05-01',
      end: '2026-07-21',
      months: ['2026-05', '2026-06', '2026-07']
    })
  })

  it('resolves "last month" as the previous whole month', () => {
    expect(resolveDateWindow({ unit: 'month', count: 1, includeCurrent: false }, TODAY)).toEqual({
      ok: true,
      start: '2026-06-01',
      end: '2026-06-30',
      months: ['2026-06']
    })
  })

  it('resolves year to date', () => {
    const r = resolveDateWindow({ unit: 'year', count: 1, includeCurrent: true }, TODAY)
    expect(r).toMatchObject({ ok: true, start: '2026-01-01', end: '2026-07-21' })
    expect(r.months).toHaveLength(7) // Jan through Jul
  })

  it('resolves the previous complete year', () => {
    expect(
      resolveDateWindow({ unit: 'year', count: 1, includeCurrent: false }, TODAY)
    ).toMatchObject({ ok: true, start: '2025-01-01', end: '2025-12-31' })
  })

  it('resolves the current quarter to date', () => {
    expect(resolveDateWindow({ unit: 'quarter', count: 1, includeCurrent: true }, TODAY)).toEqual({
      ok: true,
      start: '2026-07-01', // Q3 starts in July
      end: '2026-07-21',
      months: ['2026-07']
    })
  })

  it('resolves the previous complete quarter', () => {
    expect(resolveDateWindow({ unit: 'quarter', count: 1, includeCurrent: false }, TODAY)).toEqual({
      ok: true,
      start: '2026-04-01',
      end: '2026-06-30',
      months: ['2026-04', '2026-05', '2026-06']
    })
  })

  it('rolls a previous quarter back across the year boundary', () => {
    // mid-January: the previous complete quarter is Q4 of the prior year
    expect(
      resolveDateWindow({ unit: 'quarter', count: 1, includeCurrent: false }, '2026-01-15')
    ).toMatchObject({ ok: true, start: '2025-10-01', end: '2025-12-31' })
  })

  it('resolves the past 90 days as a rolling window ending today', () => {
    const r = resolveDateWindow({ unit: 'day', count: 90, includeCurrent: true }, TODAY)
    expect(r.ok).toBe(true)
    expect(r.end).toBe('2026-07-21')
    expect(inclusiveDays(r.start!, r.end!)).toBe(90)
  })

  it('resolves "yesterday" as one day, current excluded', () => {
    expect(
      resolveDateWindow({ unit: 'day', count: 1, includeCurrent: false }, TODAY)
    ).toMatchObject({ ok: true, start: '2026-07-20', end: '2026-07-20' })
  })

  it('treats a week as 7 rolling days', () => {
    const r = resolveDateWindow({ unit: 'week', count: 2, includeCurrent: true }, TODAY)
    expect(r).toMatchObject({ ok: true, start: '2026-07-08', end: '2026-07-21' })
    expect(inclusiveDays(r.start!, r.end!)).toBe(14)
  })

  it.each([
    [{ unit: 'month' as const, count: 0, includeCurrent: true }, TODAY],
    [{ unit: 'day' as const, count: -3, includeCurrent: true }, TODAY]
  ])('rejects a non-positive count', (spec, today) => {
    const r = resolveDateWindow(spec, today)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('count')
  })

  it('rejects an unreadable today', () => {
    const r = resolveDateWindow({ unit: 'month', count: 1, includeCurrent: true }, 'not-a-date')
    expect(r.ok).toBe(false)
  })
})
