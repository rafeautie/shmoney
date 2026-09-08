import { describe, expect, it } from 'vitest'
import { goalCreateSchema, goalUpdateSchema, startInstantForDay } from './goals'

describe('startInstantForDay', () => {
  it('is the last second before the day begins, in local time', () => {
    const instant = startInstantForDay('2026-09-07')
    const midnight = new Date(2026, 8, 7).getTime() / 1000
    expect(instant).toBe(midnight - 1)
  })

  it('lets a transaction dated at local noon that day count as strictly after', () => {
    const instant = startInstantForDay('2026-09-07')
    const noon = Math.floor(new Date(2026, 8, 7, 12).getTime() / 1000)
    expect(noon).toBeGreaterThan(instant)
  })

  it('excludes the previous day, including its last second', () => {
    const instant = startInstantForDay('2026-09-07')
    const endOfPrevious = Math.floor(new Date(2026, 8, 6, 23, 59, 59).getTime() / 1000)
    expect(endOfPrevious).toBeLessThanOrEqual(instant)
  })
})

describe('goal input schemas', () => {
  const base = { name: 'Japan trip', mode: 'contributions', targetAmount: 6_000_000 }

  it('rejects a non-positive target', () => {
    expect(goalCreateSchema.safeParse({ ...base, targetAmount: 0, accountIds: [1] }).success).toBe(
      false
    )
  })

  it('rejects an empty account list', () => {
    expect(goalCreateSchema.safeParse({ ...base, accountIds: [] }).success).toBe(false)
  })

  it('trims the name and rejects a blank one', () => {
    const parsed = goalCreateSchema.parse({ ...base, name: '  Japan trip  ', accountIds: [1] })
    expect(parsed.name).toBe('Japan trip')
    expect(goalCreateSchema.safeParse({ ...base, name: '   ', accountIds: [1] }).success).toBe(
      false
    )
  })

  it('rejects a target date that is not a real calendar day', () => {
    expect(
      goalCreateSchema.safeParse({ ...base, targetDate: '2027-13-01', accountIds: [1] }).success
    ).toBe(false)
    expect(
      goalCreateSchema.safeParse({ ...base, targetDate: '2027-03-31', accountIds: [1] }).success
    ).toBe(true)
  })

  it('has no mode on update: it cannot change after creation', () => {
    const parsed = goalUpdateSchema.parse({ id: 1, mode: 'balance' })
    expect(parsed).not.toHaveProperty('mode')
  })
})
