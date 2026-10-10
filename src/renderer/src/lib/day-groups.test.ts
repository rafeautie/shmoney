import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayKey, dayLabel, dayNet } from './day-groups'

const at = (y: number, m: number, d: number, h: number): number =>
  new Date(y, m - 1, d, h).getTime() / 1000

describe('dayKey', () => {
  it('keys by the local calendar day, whatever the time', () => {
    expect(dayKey(at(2026, 3, 5, 0))).toBe('2026-03-05')
    expect(dayKey(at(2026, 3, 5, 23))).toBe('2026-03-05')
  })

  it('puts undated rows under their own key', () => {
    expect(dayLabel(dayKey(0))).toBe('No date')
  })
})

describe('dayLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 6, 15))
  })
  afterEach(() => vi.useRealTimers())

  it('names today and yesterday', () => {
    expect(dayLabel('2026-10-06')).toBe('Today')
    expect(dayLabel('2026-10-05')).toBe('Yesterday')
  })

  it('drops the year only within the current one', () => {
    expect(dayLabel('2026-03-05')).toBe('Thu, Mar 5')
    expect(dayLabel('2025-03-05')).toBe('Wed, Mar 5, 2025')
  })
})

describe('dayNet', () => {
  it('sums each currency and adds the unloaded rest', () => {
    const rows = [
      { currency: 'USD', amount: -5_000 },
      { currency: 'EUR', amount: 2_000 },
      { currency: 'USD', amount: 1_500 }
    ]
    expect(dayNet(rows, [{ currency: 'USD', total: -500 }])).toEqual([
      { currency: 'USD', total: -4_000 },
      { currency: 'EUR', total: 2_000 }
    ])
  })

  it('ignores transfers', () => {
    const rows = [
      { currency: 'USD', amount: -5_000 },
      { currency: 'USD', amount: -10_000, isTransfer: true },
      { currency: 'EUR', amount: 3_000, isTransfer: true }
    ]
    expect(dayNet(rows)).toEqual([{ currency: 'USD', total: -5_000 }])
  })
})
