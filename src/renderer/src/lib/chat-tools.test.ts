import { describe, expect, it } from 'vitest'
import type { AnalysisToolResult } from '@shared/chat'
import { analysisToolLabel, selectedGroups } from './chat-tools'

const ok = (result: Partial<AnalysisToolResult>): AnalysisToolResult => ({
  ok: true,
  durationMs: 5,
  ...result
})

describe('analysisToolLabel', () => {
  it('names the breakdown and the period, without the parenthetical', () => {
    expect(
      analysisToolLabel(
        'totals',
        { measure: 'spending', by: 'month' },
        ok({ period: '2026-06 to 2026-08 (3 complete months)' })
      )
    ).toBe('Totaled spending by month · 2026-06 to 2026-08')
  })

  it('describes a comparison with both windows', () => {
    expect(
      analysisToolLabel(
        'totals',
        { measure: 'spending', by: 'none' },
        ok({ period: '2026-07', comparedWith: '2026-06' })
      )
    ).toBe('Compared spending · 2026-07 vs 2026-06')
  })

  it('counts listed transactions and recurring charges', () => {
    expect(analysisToolLabel('transactions', {}, ok({ rows: [[1], [2], [3], [4], [5]] }))).toBe(
      'Listed 5 transactions'
    )
    expect(analysisToolLabel('recurring', {}, ok({ facts: { count: 1 } }))).toBe(
      'Found 1 recurring charge'
    )
  })

  it('reports unusual flags, or that nothing was flagged', () => {
    expect(analysisToolLabel('unusual', {}, ok({ facts: { flags: 3 } }))).toBe(
      'Checked for anything unusual · 3 flags'
    )
    expect(analysisToolLabel('unusual', {}, ok({ facts: { flags: 0 } }))).toBe(
      'Checked for anything unusual · nothing flagged'
    )
  })

  it('picks the goals view and says when a call failed', () => {
    expect(analysisToolLabel('goals', { view: 'history' }, ok({}))).toBe('Read goal history')
    expect(analysisToolLabel('totals', {}, { ok: false, error: 'x', durationMs: 1 })).toBe(
      'Totals failed'
    )
  })
})

describe('selectedGroups', () => {
  const groups = [
    { merchant: 'Cafe', transactionIds: [1, 2], total: -10.1 },
    { merchant: 'Diner', transactionIds: [3], total: -20.2 }
  ]

  it('sums only the checked merchants', () => {
    expect(selectedGroups(groups, ['Cafe', 'Diner'])).toEqual({ count: 3, total: -30.3 })
    expect(selectedGroups(groups, ['Diner'])).toEqual({ count: 1, total: -20.2 })
    expect(selectedGroups(groups, [])).toEqual({ count: 0, total: 0 })
  })
})
