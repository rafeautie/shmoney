import { createHash } from 'node:crypto'
import type { NormalizedImportRow, ImportRowStatus } from '@shared/import'
import type { ParsedRow } from './parse'

// Stable external ids + duplicate detection. Pure (no electron/db) for vitest.

function normalizeDescription(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

// local date parts, matching how the app renders `posted` and buckets SQL
// dates ('unixepoch', 'localtime') — synced rows carry real timestamps, so
// day-matching must follow the user's calendar
function localDay(posted: number): string {
  const d = new Date(posted * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Namespace for ids this module mints. Bank-issued ids never carry it, so the
 * two id spaces can't collide — which is exactly why sync has to reconcile them
 * by content instead (see `matchImportedRows`).
 */
export const IMPORT_ID_PREFIX = 'import:'

/**
 * Assign the dedupe id stored in transactions.simplefinId. OFX FITIDs are
 * unique per account, so they map directly; formats without ids get a content
 * hash with an occurrence counter, so a file re-imports to the same ids (rows
 * skip via the unique index) while identical rows within one file stay distinct.
 * 'h1' versions the hash scheme.
 */
export function assignExternalIds(rows: ParsedRow[]): NormalizedImportRow[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    if (row.fitid !== undefined) {
      return {
        posted: row.posted,
        amount: row.amount,
        description: row.description,
        externalId: `${IMPORT_ID_PREFIX}fitid:${row.fitid}`
      }
    }
    const key = `${localDay(row.posted)}|${row.amount}|${normalizeDescription(row.description)}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    const hash = createHash('sha256').update(key).digest('hex')
    return {
      posted: row.posted,
      amount: row.amount,
      description: row.description,
      externalId: `${IMPORT_ID_PREFIX}h1:${hash}:${n}`
    }
  })
}

export interface ExistingTransaction {
  simplefinId: string | null
  posted: number
  amount: number
  deletedAt: number | null
}

/**
 * duplicate — externalId already present and live in the account. A soft-deleted
 * row holding the id does not count: it is a transaction the user deleted or an
 * import they undid, and applying restores it (see the import apply handler).
 * probable — a live existing row has the same posted day + amount (each
 * existing row explains at most one import row).
 */
export function annotateDuplicates(
  rows: NormalizedImportRow[],
  existing: ExistingTransaction[]
): (NormalizedImportRow & { status: ImportRowStatus })[] {
  const existingIds = new Set(
    existing.filter((t) => t.deletedAt === null && t.simplefinId !== null).map((t) => t.simplefinId)
  )
  const dayAmountCounts = new Map<string, number>()
  for (const t of existing) {
    if (t.deletedAt !== null) continue
    const key = `${localDay(t.posted)}|${t.amount}`
    dayAmountCounts.set(key, (dayAmountCounts.get(key) ?? 0) + 1)
  }

  return rows.map((row) => {
    if (existingIds.has(row.externalId)) return { ...row, status: 'duplicate' as const }
    const key = `${localDay(row.posted)}|${row.amount}`
    const available = dayAmountCounts.get(key) ?? 0
    if (available > 0) {
      dayAmountCounts.set(key, available - 1)
      return { ...row, status: 'probable' as const }
    }
    return { ...row, status: 'new' as const }
  })
}

/** a live manually-imported row a synced transaction may claim */
export interface ImportedCandidate {
  id: number
  posted: number
  amount: number
}

export interface IncomingTransaction {
  simplefinId: string
  posted: number
  amount: number
}

/**
 * The mirror of `annotateDuplicates`, for the other direction: an import that
 * ran ahead of the bank's own sync. Because imported ids live in their own
 * namespace, the sync upsert can never recognise those rows and would insert a
 * second copy of every one. So pair them by content first and let sync adopt
 * the existing row.
 *
 * Same local day + amount, the `probable` heuristic — a bank description rarely
 * survives a CSV export intact, and the incoming ids are by construction ones
 * we have never stored. Each candidate is claimed at most once (oldest row
 * first, so repeated claims are stable across syncs), which bounds the damage
 * when the heuristic is wrong: N imported rows absorb at most N incoming ones
 * and everything else inserts normally.
 *
 * Callers must exclude incoming transactions whose id is already stored — those
 * upsert onto their own row, and claiming as well would collide on the unique
 * index. Returns simplefinId -> claimed transaction id.
 */
export function matchImportedRows(
  incoming: IncomingTransaction[],
  candidates: ImportedCandidate[]
): Map<string, number> {
  const byDayAmount = new Map<string, number[]>()
  for (const c of [...candidates].sort((a, b) => a.id - b.id)) {
    const key = `${localDay(c.posted)}|${c.amount}`
    const bucket = byDayAmount.get(key)
    if (bucket) bucket.push(c.id)
    else byDayAmount.set(key, [c.id])
  }

  const claims = new Map<string, number>()
  for (const txn of incoming) {
    const claimed = byDayAmount.get(`${localDay(txn.posted)}|${txn.amount}`)?.shift()
    if (claimed !== undefined) claims.set(txn.simplefinId, claimed)
  }
  return claims
}
