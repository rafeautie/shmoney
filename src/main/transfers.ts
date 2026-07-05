// Pure transfer-pairing logic, kept free of DB/IPC so it can be reasoned about
// and tested in isolation. The sync handler feeds it candidate rows and marks
// whatever pairs come back.

// two legs of a transfer rarely post more than a few days apart
export const TRANSFER_WINDOW_SECONDS = 3 * 24 * 60 * 60

export interface TransferCandidate {
  id: number
  accountId: number
  /** integer milliunits; sign encodes direction */
  amount: number
  /** unix seconds */
  date: number
}

/**
 * Pair up inter-account transfers among unmarked transactions. A pair is an
 * equal-and-opposite amount in two different accounts posted within a few days.
 * Only unambiguous 1:1 matches are returned — if a leg could pair with more than
 * one candidate, none of them are matched (a wrong pairing silently corrupts
 * reports, so we defer to manual marking). Returns [lowId, highId] pairs.
 */
export function detectTransferPairs(rows: TransferCandidate[]): [number, number][] {
  // bucket by magnitude so only equal-and-opposite amounts are ever compared
  const byMagnitude = new Map<number, TransferCandidate[]>()
  for (const row of rows) {
    if (row.amount === 0) continue
    const key = Math.abs(row.amount)
    const list = byMagnitude.get(key)
    if (list) list.push(row)
    else byMagnitude.set(key, [row])
  }

  // candidate partners per transaction id (opposite sign, other account, ≤ window)
  const partners = new Map<number, number[]>()
  const addPartner = (a: number, b: number): void => {
    const list = partners.get(a)
    if (list) list.push(b)
    else partners.set(a, [b])
  }
  for (const list of byMagnitude.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (
          a.amount === -b.amount &&
          a.accountId !== b.accountId &&
          Math.abs(a.date - b.date) <= TRANSFER_WINDOW_SECONDS
        ) {
          addPartner(a.id, b.id)
          addPartner(b.id, a.id)
        }
      }
    }
  }

  const pairs: [number, number][] = []
  const paired = new Set<number>()
  for (const [id, candidates] of partners) {
    if (candidates.length !== 1 || paired.has(id)) continue
    const other = candidates[0]
    // require the match to be mutual and equally exclusive
    if (partners.get(other)?.length !== 1) continue
    paired.add(id)
    paired.add(other)
    pairs.push(id < other ? [id, other] : [other, id])
  }
  return pairs
}
