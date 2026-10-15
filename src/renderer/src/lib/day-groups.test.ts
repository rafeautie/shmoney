import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayKey } from '@shared/days'
import { dayLabel } from './day-groups'

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

  it('names undated rows', () => {
    expect(dayLabel(dayKey(0))).toBe('No date')
  })
})
