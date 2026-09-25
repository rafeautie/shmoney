import { describe, expect, it } from 'vitest'
import { fixtureContext } from './test-fixture'
import { merchantOf } from './merchant'
import { completeMonths, resolveComparison, resolvePeriod } from './period'

describe('analysis fixture', () => {
  it('seeds the scoped views with merchants', () => {
    const ctx = fixtureContext()
    const rows = ctx.db
      .prepare('SELECT merchant, COUNT(*) AS n FROM temp.tx GROUP BY merchant ORDER BY n DESC')
      .all() as { merchant: string; n: number }[]
    expect(rows.map((r) => r.merchant)).toContain('Whole Foods Mkt')
    expect(rows.map((r) => r.merchant)).toContain('Amazon')
    expect(rows.find((r) => r.merchant === 'Tacos El Gordo')).toBeTruthy()
  })
})

describe('merchantOf', () => {
  it.each([
    ['AMAZON.COM*RT4K21', 'Amazon'],
    ['SQ *TACOS EL GORDO', 'Tacos El Gordo'],
    ['WHOLE FOODS MKT #10233', 'Whole Foods Mkt'],
    ['TARGET T-2766', 'Target'],
    ['CHIPOTLE 2291', 'Chipotle'],
    ['APPLE.COM/BILL', 'Apple'],
    ['REI #45 BERKELEY', 'REI'],
    ['CVS/PHARMACY #9912', 'CVS/Pharmacy'],
    ["TRADER JOE'S #552", "Trader Joe's"],
    ['UBER *TRIP', 'Uber']
  ])('%s -> %s', (raw, want) => expect(merchantOf(raw)).toBe(want))
})

describe('periods', () => {
  const today = '2026-09-24'
  const data = { min: '2025-09-10', max: '2026-09-20' }
  it('reads last_N_months as complete months', () => {
    const r = resolvePeriod('last 3 months', today, data)
    expect(r.ok && r.window).toMatchObject({
      start: '2026-06-01',
      end: '2026-08-31',
      partial: false
    })
  })
  it('clips this_month to today and aligns a comparison to the same days', () => {
    const base = resolvePeriod('this_month', today, data)
    if (!base.ok) throw new Error()
    expect(base.window).toMatchObject({ start: '2026-09-01', end: '2026-09-24', partial: true })
    const cmp = resolveComparison('previous', base.window, today, data)
    expect(cmp.ok && cmp.window).toMatchObject({ start: '2026-08-01', end: '2026-08-24' })
    expect(cmp.ok && cmp.whole).toMatchObject({ start: '2026-08-01', end: '2026-08-31' })
  })
  it('parses months, quarters, years and month names', () => {
    const get = (s: string): unknown => {
      const r = resolvePeriod(s, today, data)
      return r.ok ? [r.window.start, r.window.end] : r.error
    }
    expect(get('2026-07')).toEqual(['2026-07-01', '2026-07-31'])
    expect(get('2026-Q2')).toEqual(['2026-04-01', '2026-06-30'])
    expect(get('2025')).toEqual(['2025-01-01', '2025-12-31'])
    expect(get('July 2026')).toEqual(['2026-07-01', '2026-07-31'])
    expect(get('march')).toEqual(['2026-03-01', '2026-03-31'])
    expect(get('someday')).toMatch(/Unknown period/)
  })
  it('previous of a complete month and last_year of a quarter', () => {
    const july = resolvePeriod('2026-07', today, data)
    if (!july.ok) throw new Error()
    const prev = resolveComparison('previous', july.window, today, data)
    expect(prev.ok && prev.window).toMatchObject({
      start: '2026-06-01',
      end: '2026-06-30',
      label: '2026-06'
    })
    const q2 = resolvePeriod('2026-Q2', today, data)
    if (!q2.ok) throw new Error()
    const ly = resolveComparison('last_year', q2.window, today, data)
    expect(ly.ok && ly.window).toMatchObject({
      start: '2025-04-01',
      end: '2025-06-30',
      label: '2025-Q2'
    })
  })
  it('cuts a partial base only against a comparison of the same calendar length', () => {
    const cmp = (base: string, spec: string): unknown => {
      const b = resolvePeriod(base, today, data)
      if (!b.ok) throw new Error()
      const r = resolveComparison(spec, b.window, today, data)
      return r.ok ? [r.window.start, r.window.end, r.whole !== null] : r.error
    }
    expect(cmp('this_month', 'last_3_months')).toEqual(['2026-06-01', '2026-08-31', false])
    expect(cmp('this_year', 'this_month')).toEqual(['2026-09-01', '2026-09-24', false])
    expect(cmp('this_month', '2026-02')).toEqual(['2026-02-01', '2026-02-24', true])
    expect(cmp('this_year', '2025')).toEqual(['2025-01-01', '2025-09-24', true])
    expect(cmp('this_year', 'last_year')).toEqual(['2025-01-01', '2025-09-24', true])
  })
  it('reads quarter-first spellings', () => {
    for (const spec of ['Q2 2026', 'q2_2026', 'Q2-2026', 'q22026', '2026Q2']) {
      const r = resolvePeriod(spec, today, data)
      expect(r.ok && [r.window.start, r.window.end, r.window.label]).toEqual([
        '2026-04-01',
        '2026-06-30',
        '2026-Q2'
      ])
    }
  })
  it('refuses a period that has not started', () => {
    const error = (s: string): string | null => {
      const r = resolvePeriod(s, today, data)
      return r.ok ? null : r.error
    }
    expect(error('2026-12')).toBe("2026-12 hasn't started yet; the data runs to 2026-09-20.")
    expect(error('2026-Q4')).toBe("2026-Q4 hasn't started yet; the data runs to 2026-09-20.")
    expect(error('2027')).toBe("2027 hasn't started yet; the data runs to 2026-09-20.")
    expect(error('december 2026')).toMatch(/^2026-12 hasn't started yet/)
    expect(error('2026-09')).toBeNull()
    expect(error('2026-Q3')).toBeNull()
  })
  it('counts only whole, covered months', () => {
    const all = resolvePeriod('all', today, data)
    if (!all.ok) throw new Error()
    const months = completeMonths(all.window, today, data)
    expect(months[0]).toBe('2025-10')
    expect(months.at(-1)).toBe('2026-08')
    expect(months).toHaveLength(11)
  })
})

describe('merchantOf payment rails', () => {
  it.each([
    ['ZELLE PAYMENT TO OAKWOOD PROPERTIES', 'Oakwood Properties'],
    ['SPOTIFY USA', 'Spotify'],
    ['VENMO TO ALEX KIM', 'Alex Kim']
  ])('%s -> %s', (raw, want) => expect(merchantOf(raw)).toBe(want))
})
