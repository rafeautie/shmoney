import { describe, it, expect } from 'vitest'
import { parseSignedAmount } from './utils'

describe('parseSignedAmount', () => {
  it('keeps the sign literal: negative = expense, positive = income', () => {
    expect(parseSignedAmount('-12.34')).toBe(-12340)
    expect(parseSignedAmount('5')).toBe(5000)
  })

  it('strips currency symbols, commas, and spaces', () => {
    expect(parseSignedAmount('$-12.34')).toBe(-12340)
    expect(parseSignedAmount('1,234.56')).toBe(1234560)
    expect(parseSignedAmount(' -3.50 ')).toBe(-3500)
  })

  it('rejects empty, non-numeric, and zero-rounding input', () => {
    expect(parseSignedAmount('')).toBeNull()
    expect(parseSignedAmount('   ')).toBeNull()
    expect(parseSignedAmount('abc')).toBeNull()
    expect(parseSignedAmount('0')).toBeNull()
    expect(parseSignedAmount('-0.0004')).toBeNull()
  })
})
