import { describe, expect, it } from 'vitest'
import { backProjectSeries, bucketsUpToNow, computePace, suffixFlows, type PaceInput } from './pace'

const sec = (y: number, m: number, d: number): number =>
  Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000)

const base: PaceInput = {
  targetAmount: 12_000_000,
  baselineAmount: 0,
  progress: 0,
  startedAt: sec(2026, 1, 1),
  targetDate: '2026-12-31',
  now: sec(2026, 7, 1)
}

describe('computePace status', () => {
  it('is reached once progress meets the target, whatever the date says', () => {
    expect(computePace({ ...base, progress: 12_000_000 }).status).toBe('reached')
    expect(computePace({ ...base, progress: 20_000_000, now: sec(2027, 3, 1) }).status).toBe(
      'reached'
    )
  })

  it('is no-date for an undated goal', () => {
    const pace = computePace({ ...base, targetDate: null, progress: 1_000_000 })
    expect(pace.status).toBe('no-date')
    expect(pace.expectedByNow).toBeNull()
    expect(pace.neededPerMonth).toBeNull()
  })

  it('is overdue past the end of the target day, not on it', () => {
    expect(computePace({ ...base, now: sec(2026, 12, 31) }).status).toBe('behind')
    expect(computePace({ ...base, now: sec(2027, 1, 1) }).status).toBe('overdue')
  })

  it('is behind below the pace line and on track at or above it', () => {
    expect(computePace({ ...base, progress: 6_000_000 }).status).toBe('on-track')
    expect(computePace({ ...base, progress: 1_000_000 }).status).toBe('behind')
  })

  it('treats a target date that is today as not yet overdue', () => {
    const pace = computePace({ ...base, targetDate: '2026-07-01', progress: 1_000_000 })
    expect(pace.status).toBe('behind')
  })
})

describe('computePace figures', () => {
  it('never reports negative remaining', () => {
    expect(computePace({ ...base, progress: 20_000_000 }).remaining).toBe(0)
  })

  it('divides what is left across the calendar months remaining', () => {
    const pace = computePace({ ...base, progress: 2_000_000 })
    expect(pace.neededPerMonth).toBe(10_000_000 / 5)
  })

  it('floors months remaining at one, so the last month is not a divide by zero', () => {
    const pace = computePace({ ...base, progress: 2_000_000, now: sec(2026, 12, 20) })
    expect(pace.neededPerMonth).toBe(10_000_000)
  })

  it('counts calendar months across a year boundary', () => {
    const pace = computePace({
      ...base,
      startedAt: sec(2025, 11, 1),
      targetDate: '2026-02-28',
      now: sec(2026, 1, 1),
      progress: 2_000_000
    })
    expect(pace.averagePerMonth).toBe(1_000_000)
    expect(pace.neededPerMonth).toBe(10_000_000)
  })

  it('gives no monthly figure once the goal is reached or overdue', () => {
    expect(computePace({ ...base, progress: 12_000_000 }).neededPerMonth).toBeNull()
    expect(computePace({ ...base, now: sec(2027, 2, 1) }).neededPerMonth).toBeNull()
  })

  it('floors months elapsed at one, so a same-month goal has a finite average', () => {
    const pace = computePace({ ...base, now: sec(2026, 1, 20), progress: 500_000 })
    expect(pace.averagePerMonth).toBe(500_000)
  })

  it('measures the average from the baseline, not from zero', () => {
    const pace = computePace({
      ...base,
      baselineAmount: 4_000_000,
      progress: 10_000_000
    })
    expect(pace.averagePerMonth).toBe(1_000_000)
  })

  it('runs the pace line from the baseline to the target', () => {
    const pace = computePace({ ...base, baselineAmount: 6_000_000, progress: 6_000_000 })
    expect(pace.expectedByNow).toBeGreaterThan(8_800_000)
    expect(pace.expectedByNow).toBeLessThan(9_200_000)
  })
})

describe('computePace projection', () => {
  it('projects from the current average', () => {
    const pace = computePace({ ...base, progress: 3_000_000 })
    expect(pace.projectedDate).toBe('2028-01-01')
  })

  it('has no projection at a zero or negative average', () => {
    expect(computePace({ ...base, progress: 0 }).projectedDate).toBeNull()
    expect(
      computePace({ ...base, baselineAmount: 5_000_000, progress: 1_000_000 }).projectedDate
    ).toBeNull()
  })

  it('has no projection once reached', () => {
    expect(computePace({ ...base, progress: 12_000_000 }).projectedDate).toBeNull()
  })
})

describe('suffixFlows and backProjectSeries', () => {
  const buckets = [
    { label: '2026-04', endSec: sec(2026, 4, 30) },
    { label: '2026-05', endSec: sec(2026, 5, 31) },
    { label: '2026-06', endSec: sec(2026, 6, 30) }
  ]

  it('sums everything after each bucket, and nothing after the last', () => {
    const after = suffixFlows(
      buckets,
      new Map([
        ['2026-05', 100],
        ['2026-06', 30]
      ])
    )
    expect(after.get('2026-06')).toBe(0)
    expect(after.get('2026-05')).toBe(30)
    expect(after.get('2026-04')).toBe(130)
  })

  it('ends the series on the goal’s current saved amount', () => {
    const after = suffixFlows(buckets, new Map([['2026-06', 500]]))
    const points = backProjectSeries(5_000, buckets, after, null)
    expect(points.at(-1)).toEqual({ label: '2026-06', saved: 5_000 })
  })

  it('repeats the next bucket’s value through a bucket with no flows', () => {
    const after = suffixFlows(buckets, new Map([['2026-06', 500]]))
    const points = backProjectSeries(5_000, buckets, after, null)
    expect(points[0].saved).toBe(4_500)
    expect(points[1].saved).toBe(4_500)
  })

  it('drops buckets that ended before a contributions goal existed', () => {
    const after = suffixFlows(buckets, new Map())
    const points = backProjectSeries(5_000, buckets, after, sec(2026, 5, 15))
    expect(points.map((p) => p.label)).toEqual(['2026-05', '2026-06'])
  })

  it('keeps every bucket in balance mode, where earlier balances are real', () => {
    const after = suffixFlows(buckets, new Map())
    const points = backProjectSeries(5_000, buckets, after, null)
    expect(points).toHaveLength(3)
  })
})

describe('bucketsUpToNow', () => {
  const now = new Date(2026, 8, 7, 12)

  it('runs ascending and ends on the bucket containing now', () => {
    const buckets = bucketsUpToNow('month', sec(2026, 6, 1), now)
    expect(buckets.map((b) => b.label)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
  })

  it('drops the oldest buckets when capped, never the newest', () => {
    // day grain over ~8 years is well past MAX_BUCKETS
    const buckets = bucketsUpToNow('day', sec(2018, 1, 1), now)
    expect(buckets).toHaveLength(1000)
    // the newest bucket has to survive: back-projection reports savedNow there
    expect(buckets.at(-1)?.label).toBe('2026-09-07')
    expect(buckets[0].label > '2018-01-01').toBe(true)
  })

  it('gives one bucket when the start is inside the current one', () => {
    expect(bucketsUpToNow('month', sec(2026, 9, 3), now).map((b) => b.label)).toEqual(['2026-09'])
  })

  it('ends each bucket at its own last instant', () => {
    const [june] = bucketsUpToNow('month', sec(2026, 6, 1), now)
    expect(new Date(june.endSec * 1000).getMonth()).toBe(5)
    expect(new Date(june.endSec * 1000).getDate()).toBe(30)
  })
})
