import { describe, expect, it } from 'vitest'
import { dayKey, isNoDate } from './days'

const at = (y: number, m: number, d: number, h: number): number =>
  new Date(y, m - 1, d, h).getTime() / 1000

describe('dayKey', () => {
  it('keys by the local calendar day, whatever the time', () => {
    expect(dayKey(at(2026, 3, 5, 0))).toBe('2026-03-05')
    expect(dayKey(at(2026, 3, 5, 23))).toBe('2026-03-05')
  })

  it('puts undated rows under their own key', () => {
    expect(isNoDate(dayKey(0))).toBe(true)
  })
})
