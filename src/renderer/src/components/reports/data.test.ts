import { describe, expect, it } from 'vitest'
import { pivotTimeSeries, projectInProgress } from './data'

const rows = (values: number[]) => values.map((v, i) => ({ bucket: `b${i}`, s: v }))

describe('projectInProgress', () => {
  it('heads for the typical bucket', () => {
    // 3 days into a month with rent already paid
    const raw = rows([4000, 4500, 5000, 2600])
    expect(projectInProgress(raw, raw, 3, ['s'], 0.1)).toEqual({ s: 4500 })
  })

  it('keeps what the bucket already holds once it passes the typical one', () => {
    const raw = rows([4000, 4500, 5000, 5200])
    expect(projectInProgress(raw, raw, 3, ['s'], 0.8)).toEqual({ s: 5200 })
  })

  it('lands a cumulative projection on the running total', () => {
    const raw = rows([100, 100, 50])
    const shown = rows([100, 200, 250])
    expect(projectInProgress(raw, shown, 2, ['s'], 0.5)).toEqual({ s: 300 })
  })

  it('falls back to a straight line without history, but not too early', () => {
    const raw = rows([300])
    expect(projectInProgress(raw, raw, 0, ['s'], 0.5)).toEqual({ s: 600 })
    expect(projectInProgress(raw, raw, 0, ['s'], 0.1)).toBeNull()
  })

  it('projects nothing outside the bucket', () => {
    const raw = rows([1, 2])
    expect(projectInProgress(raw, raw, 5, ['s'], 0.5)).toBeNull()
    expect(projectInProgress(raw, raw, 1, ['s'], 1)).toBeNull()
  })
})

describe('pivotTimeSeries', () => {
  it('leaves buckets after now empty, so running totals stop at today', () => {
    const start = new Date(2026, 10, 1).getTime() / 1000
    const end = new Date(2026, 10, 30, 23, 59, 59).getTime() / 1000
    const now = new Date(2026, 10, 3, 12).getTime() / 1000
    const { data } = pivotTimeSeries(
      [{ bucket: '2026-11-02', groupId: null, groupLabel: null, currency: 'USD', value: 5000 }],
      'day',
      start,
      end,
      true,
      true,
      now
    )
    const key = 's_null_USD'
    expect(data[0][key]).toBe(0)
    expect(data[1][key]).toBe(5000)
    expect(data[2][key]).toBe(5000)
    expect(data[3][key]).toBeUndefined()
    expect(data).toHaveLength(30)
  })
})
