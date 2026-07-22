import { describe, it, expect } from 'vitest'
import { buildUpdateChanges, isSyncOwned, transactionUpdateSchema } from './ipc'

describe('transactionUpdateSchema', () => {
  it('accepts an id with no fields (nothing to change)', () => {
    expect(transactionUpdateSchema.parse({ id: 1 })).toEqual({ id: 1 })
  })

  it('rejects a zero amount', () => {
    expect(() => transactionUpdateSchema.parse({ id: 1, amount: 0 })).toThrow(
      'Amount must not be zero'
    )
  })

  it('rejects a malformed date', () => {
    expect(() => transactionUpdateSchema.parse({ id: 1, date: '07/22/2026' })).toThrow('YYYY-MM-DD')
  })

  it('rejects an empty or over-long description', () => {
    expect(() => transactionUpdateSchema.parse({ id: 1, description: '   ' })).toThrow()
    expect(() => transactionUpdateSchema.parse({ id: 1, description: 'x'.repeat(201) })).toThrow()
  })

  it('distinguishes categoryId null (set Uncategorized) from omitted (unchanged)', () => {
    const withNull = transactionUpdateSchema.parse({ id: 1, categoryId: null })
    expect('categoryId' in withNull && withNull.categoryId === null).toBe(true)
    const omitted = transactionUpdateSchema.parse({ id: 1 })
    expect('categoryId' in omitted).toBe(false)
  })
})

describe('isSyncOwned', () => {
  it('never owns rows on manual accounts', () => {
    expect(isSyncOwned(null, 'sfin-abc')).toBe(false)
  })

  it('owns bank-id rows on connected accounts', () => {
    expect(isSyncOwned(1, 'sfin-abc')).toBe(true)
  })

  it("app-generated ids can't collide with the bank's, even on connected accounts", () => {
    expect(isSyncOwned(1, 'manual:6f9c3e00-0000-0000-0000-000000000000')).toBe(false)
    expect(isSyncOwned(1, 'import:fitid:F123')).toBe(false)
    expect(isSyncOwned(1, 'import:h1:abcd:0')).toBe(false)
  })
})

describe('buildUpdateChanges', () => {
  const current = { amount: -12500, description: 'COFFEE', posted: 1_700_000_000, categoryId: 3 }

  it('returns empty when nothing differs', () => {
    expect(buildUpdateChanges(current, { ...current }, 1)).toEqual([])
    expect(buildUpdateChanges(current, {}, 1)).toEqual([])
  })

  it('skips no-op fields and keeps only real changes', () => {
    const changes = buildUpdateChanges(current, { amount: -12500, categoryId: null }, 1)
    expect(changes).toEqual([{ transactionId: 1, field: 'categoryId', before: 3, after: null }])
  })

  it('emits one change per differing field, description as the string variant', () => {
    const changes = buildUpdateChanges(
      current,
      { amount: -9900, description: 'Blue Bottle', posted: 1_700_086_400, categoryId: 7 },
      42
    )
    expect(changes).toEqual([
      { transactionId: 42, field: 'amount', before: -12500, after: -9900 },
      { transactionId: 42, field: 'description', before: 'COFFEE', after: 'Blue Bottle' },
      { transactionId: 42, field: 'posted', before: 1_700_000_000, after: 1_700_086_400 },
      { transactionId: 42, field: 'categoryId', before: 3, after: 7 }
    ])
  })
})
