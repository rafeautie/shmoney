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
      return { posted: row.posted, amount: row.amount, description: row.description, externalId: `import:fitid:${row.fitid}` }
    }
    const key = `${localDay(row.posted)}|${row.amount}|${normalizeDescription(row.description)}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    const hash = createHash('sha256').update(key).digest('hex')
    return { posted: row.posted, amount: row.amount, description: row.description, externalId: `import:h1:${hash}:${n}` }
  })
}

export interface ExistingTransaction {
  simplefinId: string | null
  posted: number
  amount: number
  deletedAt: number | null
}

/**
 * duplicate — externalId already present in the account. Soft-deleted rows
 * count too: the unique index still holds them, so the insert would skip.
 * probable — a live existing row has the same posted day + amount (each
 * existing row explains at most one import row).
 */
export function annotateDuplicates(
  rows: NormalizedImportRow[],
  existing: ExistingTransaction[]
): (NormalizedImportRow & { status: ImportRowStatus })[] {
  const existingIds = new Set(existing.map((t) => t.simplefinId).filter((id) => id !== null))
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
