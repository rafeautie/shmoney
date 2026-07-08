import { describe, it, expect } from 'vitest'
import { detectTransferPairs, TRANSFER_WINDOW_SECONDS, type TransferCandidate } from './transfers'

const DAY = 24 * 60 * 60

// a transfer leg; id is required (pairing and toMark are keyed by it), the rest
// default to an equal-and-opposite-friendly baseline
function leg(over: Partial<TransferCandidate> & Pick<TransferCandidate, 'id'>): TransferCandidate {
  return { accountId: 1, amount: -5000, date: 1000, isTransfer: false, ...over }
}

describe('detectTransferPairs', () => {
  it('pairs equal-and-opposite legs in different accounts within the window', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000 }),
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000 + DAY })
    ])
    expect(pairs).toEqual([{ ids: [1, 2], toMark: [1, 2] }])
  })

  it('completes a transfer when one leg was already marked in an earlier sync', () => {
    const pairs = detectTransferPairs([
      // hand-marked by the user before its partner had synced
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000, isTransfer: true }),
      // arrives in a later sync
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000 + DAY })
    ])
    // only the newly-arrived leg is flipped; the hand-marked one is left as-is
    expect(pairs).toEqual([{ ids: [1, 2], toMark: [2] }])
  })

  it('yields no work when both legs are already marked', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000, isTransfer: true }),
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000, isTransfer: true })
    ])
    expect(pairs).toEqual([])
  })

  it('does not re-pair an already-paired marked leg with a new lookalike', () => {
    const pairs = detectTransferPairs([
      // a real, already-detected transfer (both legs marked)
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000, isTransfer: true }),
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000, isTransfer: true }),
      // a new unrelated txn that happens to be equal-and-opposite to leg 1
      leg({ id: 3, accountId: 3, amount: 5000, date: 1000 + DAY })
    ])
    // leg 1 already has a partner (leg 2), so it has two candidates and matches
    // none — the new leg stays unmarked rather than corrupting the real pair
    expect(pairs).toEqual([])
  })

  it('defers when a marked leg could complete more than one new leg', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000, isTransfer: true }),
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000 }),
      leg({ id: 3, accountId: 3, amount: 5000, date: 1000 })
    ])
    expect(pairs).toEqual([])
  })

  it('defers ambiguous unmarked matches (a leg with two candidates)', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000 }),
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000 }),
      leg({ id: 3, accountId: 3, amount: 5000, date: 1000 })
    ])
    expect(pairs).toEqual([])
  })

  it('does not pair legs in the same account', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000 }),
      leg({ id: 2, accountId: 1, amount: 5000, date: 1000 })
    ])
    expect(pairs).toEqual([])
  })

  it('does not pair legs outside the time window', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: -5000, date: 1000 }),
      leg({ id: 2, accountId: 2, amount: 5000, date: 1000 + TRANSFER_WINDOW_SECONDS + 1 })
    ])
    expect(pairs).toEqual([])
  })

  it('ignores zero-amount rows', () => {
    const pairs = detectTransferPairs([
      leg({ id: 1, accountId: 1, amount: 0, date: 1000 }),
      leg({ id: 2, accountId: 2, amount: 0, date: 1000 })
    ])
    expect(pairs).toEqual([])
  })
})
