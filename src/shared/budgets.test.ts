import { describe, expect, it } from 'vitest'
import { groupEnvelopes, monthPace, type EnvelopeSummary } from './budgets'

function envelope(
  categoryId: number,
  groupId: number | null,
  fill: number,
  spent: number
): EnvelopeSummary {
  return {
    categoryId,
    categoryName: `c${categoryId}`,
    groupId,
    groupName: groupId === null ? null : `g${groupId}`,
    startMonth: '2026-01',
    fill,
    spent,
    balance: fill - spent
  }
}

describe('groupEnvelopes', () => {
  it('keeps the incoming order and subtotals each group', () => {
    const sections = groupEnvelopes([
      envelope(1, 2, 100, 30),
      envelope(2, 2, 50, 60),
      envelope(3, 1, 20, 0),
      envelope(4, null, 10, 5)
    ])
    expect(sections.map((s) => s.groupId)).toEqual([2, 1, null])
    expect(sections[0].envelopes.map((e) => e.categoryId)).toEqual([1, 2])
    expect(sections[0].totals).toEqual({ fill: 150, spent: 90, balance: 60 })
    expect(sections[2].groupName).toBeNull()
  })

  it('is empty for no envelopes', () => {
    expect(groupEnvelopes([])).toEqual([])
  })
})

describe('monthPace', () => {
  it('is the elapsed share of the current month', () => {
    // halfway through a 30-day month
    expect(monthPace('2026-09', new Date(2026, 8, 16))).toBeCloseTo(0.5, 5)
    expect(monthPace('2026-09', new Date(2026, 8, 1))).toBe(0)
  })

  it('is null for past and future months', () => {
    const now = new Date(2026, 8, 16)
    expect(monthPace('2026-08', now)).toBeNull()
    expect(monthPace('2026-10', now)).toBeNull()
    expect(monthPace('2025-09', now)).toBeNull()
  })
})
