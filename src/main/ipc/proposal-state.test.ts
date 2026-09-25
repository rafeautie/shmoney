import { describe, expect, it } from 'vitest'
import type { ChatMessagePart, Proposal, ProposalDisplay } from '@shared/chat'
import {
  approvedDisplay,
  deniedDisplay,
  proposalActionIds,
  proposalAt,
  proposalLabels,
  reconciledDisplay,
  reconciledParts,
  selectedRows,
  selectedTransactionIds,
  unchangedSincePreview,
  undoneDisplay,
  withDisplay
} from './proposal-state'

const recategorize: Extract<Proposal, { kind: 'recategorize' }> = {
  kind: 'recategorize',
  toCategoryId: 7,
  toCategory: 'Dining',
  groups: [
    { merchant: 'Blue Bottle', transactionIds: [1, 2], total: -13 },
    { merchant: 'Tacos', transactionIds: [3], total: -24 }
  ],
  sample: [],
  currency: 'USD'
}

const pending: ProposalDisplay = {
  proposal: recategorize,
  status: 'approval-requested',
  actionId: null,
  applied: null,
  skipped: null
}

const parts = (display: ProposalDisplay | null, name = 'recategorize'): ChatMessagePart[] => [
  { type: 'text', text: 'Here it is.' },
  {
    type: 'functionCall',
    durationMs: 3,
    name: name as 'recategorize',
    args: {},
    result: { ok: display !== null },
    display
  }
]

describe('proposal part state', () => {
  it('finds a proposal in the expected state', () => {
    expect(proposalAt(parts(pending), 1, 'approval-requested')).toBe(pending)
  })

  it('refuses the wrong part, a failed proposal, or the wrong state', () => {
    expect(() => proposalAt(parts(pending), 0, 'approval-requested')).toThrow(/not a tool call/)
    expect(() => proposalAt(parts(pending), 5, 'approval-requested')).toThrow(/not a tool call/)
    expect(() => proposalAt(parts(pending, 'totals'), 1, 'approval-requested')).toThrow(
      /not a proposal/
    )
    expect(() => proposalAt(parts(null), 1, 'approval-requested')).toThrow(/nothing to apply/)
    expect(() => proposalAt(parts(pending), 1, 'approved')).toThrow(
      /approval-requested, not approved/
    )
  })

  it('moves through approve and undo, or deny', () => {
    const approved = approvedDisplay(pending, { actionId: 12, applied: 2, skipped: 1 })
    expect(approved).toMatchObject({ status: 'approved', actionId: 12, applied: 2, skipped: 1 })
    expect(undoneDisplay(approved)).toMatchObject({ status: 'undone', actionId: 12 })
    expect(deniedDisplay(pending).status).toBe('denied')
    const nothing = approvedDisplay(pending, { actionId: null, applied: 0, skipped: 3 })
    expect(() => undoneDisplay(nothing)).toThrow(/nothing to undo/)
  })

  it('rewrites only the target part', () => {
    const before = parts(pending)
    const after = withDisplay(before, 1, deniedDisplay(pending))
    expect(after[0]).toBe(before[0])
    expect((after[1] as { display: ProposalDisplay }).display.status).toBe('denied')
    expect((before[1] as { display: ProposalDisplay }).display.status).toBe('approval-requested')
  })

  it('narrows a recategorize to the checked merchants', () => {
    expect(selectedTransactionIds(recategorize)).toEqual([1, 2, 3])
    expect(selectedTransactionIds(recategorize, ['Tacos'])).toEqual([3])
    expect(selectedTransactionIds(recategorize, [])).toEqual([])
  })

  it('pairs each row with its preview category, undefined on older proposals', () => {
    const withFrom = {
      ...recategorize,
      groups: [{ ...recategorize.groups[0], fromCategoryIds: [4, null] }, recategorize.groups[1]]
    }
    expect(selectedRows(withFrom)).toEqual([
      { id: 1, from: 4 },
      { id: 2, from: null },
      { id: 3, from: undefined }
    ])
  })

  it('keeps only live rows still in their preview category', () => {
    const rows = [
      { id: 1, from: 4 },
      { id: 2, from: null },
      { id: 3, from: 4 },
      { id: 4, from: undefined },
      { id: 5, from: 4 }
    ]
    // 3 was recategorized by hand; 5 is deleted or pending, so not in current
    const current = new Map<number, number | null>([
      [1, 4],
      [2, null],
      [3, 9],
      [4, 9]
    ])
    expect(unchangedSincePreview(rows, current)).toEqual([1, 2, 4])
  })

  it('keeps amounts out of activity labels', () => {
    expect(proposalLabels.setBudget('Groceries')).toBe('Changed Groceries budget from chat')
  })
})

describe('reconciling with the action log', () => {
  const approved = approvedDisplay(pending, { actionId: 12, applied: 2, skipped: 0 })
  const undone = undoneDisplay(approved)

  it('follows the entry: applied is approved, undone is undone', () => {
    expect(reconciledDisplay(undone, null).status).toBe('approved')
    expect(reconciledDisplay(approved, 1_700_000_000_000).status).toBe('undone')
    expect(reconciledDisplay(approved, null)).toEqual(approved)
  })

  it('keeps the stored status but drops the id when the entry is gone', () => {
    expect(reconciledDisplay(approved, undefined)).toMatchObject({
      status: 'approved',
      actionId: null
    })
  })

  it('leaves pending, denied and no-op proposals alone', () => {
    expect(reconciledDisplay(pending, undefined)).toBe(pending)
    expect(reconciledDisplay(deniedDisplay(pending), undefined).status).toBe('denied')
    const nothing = approvedDisplay(pending, { actionId: null, applied: 0, skipped: 2 })
    expect(reconciledDisplay(nothing, undefined)).toBe(nothing)
  })

  it('reconciles every proposal part in a message', () => {
    const message = parts(approved)
    expect(proposalActionIds(message)).toEqual([12])
    expect(proposalActionIds(parts(pending))).toEqual([])
    const next = reconciledParts(message, new Map([[12, 5]]))
    expect(next[0]).toBe(message[0])
    expect((next[1] as { display: ProposalDisplay }).display.status).toBe('undone')
  })
})
