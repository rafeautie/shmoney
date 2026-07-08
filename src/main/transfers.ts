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
  /** whether this leg is already marked as a transfer */
  isTransfer: boolean
}

export interface TransferPair {
  /** both legs of the pair, low id first */
  ids: [number, number]
  /** the subset of legs that were previously unmarked and must be flipped */
  toMark: number[]
}

/**
 * Pair up inter-account transfers. A pair is an equal-and-opposite amount in two
 * different accounts posted within a few days. Only unambiguous 1:1 matches are
 * returned — if a leg could pair with more than one candidate, none of them are
 * matched (a wrong pairing silently corrupts reports, so we defer to manual
 * marking).
 *
 * Rows already marked as transfers are included so a leg the user marked by hand
 * in an earlier sync still completes when its partner arrives. Their edges still
 * count toward the 1:1 exclusivity check, which is what keeps an already-paired
 * marked leg from being poached by a new lookalike: it already has a partner, so
 * it has two candidates and matches none. A pair whose legs are both already
 * marked is a known transfer and yields no work.
 *
 * Each returned pair lists the legs to flip in `toMark` (empty legs are the ones
 * that were already marked, so they're left untouched — re-marking them would
 * log a bogus false→true change that undo could then reverse).
 */
export function detectTransferPairs(rows: TransferCandidate[]): TransferPair[] {
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

  const marked = new Map(rows.map((r) => [r.id, r.isTransfer]))
  const pairs: TransferPair[] = []
  const paired = new Set<number>()
  for (const [id, candidates] of partners) {
    if (candidates.length !== 1 || paired.has(id)) continue
    const other = candidates[0]
    // require the match to be mutual and equally exclusive
    if (partners.get(other)?.length !== 1) continue
    const idMarked = marked.get(id) === true
    const otherMarked = marked.get(other) === true
    // both legs already marked: a known transfer, nothing to do
    if (idMarked && otherMarked) continue
    paired.add(id)
    paired.add(other)
    const toMark: number[] = []
    if (!idMarked) toMark.push(id)
    if (!otherMarked) toMark.push(other)
    pairs.push({ ids: id < other ? [id, other] : [other, id], toMark })
  }
  return pairs
}
