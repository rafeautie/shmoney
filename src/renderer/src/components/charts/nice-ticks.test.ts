import { describe, expect, it } from 'vitest'
import { niceScale } from './nice-ticks'

describe('niceScale', () => {
  it('lands money axes on round steps', () => {
    // $1,350 in milliunits: Recharts drew 350 / 700 / 1,050
    expect(niceScale(0, 1_350_000).ticks).toEqual([0, 500_000, 1_000_000, 1_500_000])
    expect(niceScale(0, 5_200_000).ticks).toEqual([0, 2_000_000, 4_000_000, 6_000_000])
  })

  it('spans zero for all-positive and all-negative data', () => {
    expect(niceScale(200, 900).domain[0]).toBe(0)
    expect(niceScale(-900, -200).domain).toEqual([-1000, 0])
  })

  it('covers both signs', () => {
    const { ticks } = niceScale(-3_000_000, 9_000_000)
    expect(ticks[0]).toBeLessThanOrEqual(-3_000_000)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(9_000_000)
    expect(ticks).toContain(0)
  })

  it('keeps count axes whole', () => {
    expect(niceScale(0, 1, true).ticks).toEqual([0, 1])
    expect(niceScale(0, 3, true).ticks).toEqual([0, 1, 2, 3])
  })

  it('handles an empty or flat range', () => {
    expect(niceScale(0, 0).ticks.length).toBeGreaterThan(1)
    expect(niceScale(NaN, 5).domain).toEqual([0, 1])
  })
})
