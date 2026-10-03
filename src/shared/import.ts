import { z } from 'zod'

// ---------- manual file import (CSV/TSV, OFX, QFX, QIF) ----------

export const IMPORT_IPC = {
  pickFile: 'import:pick-file',
  preview: 'import:preview',
  apply: 'import:apply',
  /** forget a picked file's parsed rows in main */
  release: 'import:release'
} as const

// a parsed file row normalized to the app's units, ready to preview/insert.
// externalId is the stable dedupe key stored in transactions.simplefinId; the
// 'import:' prefix keeps it from ever colliding with a SimpleFIN id
export const normalizedImportRowSchema = z.object({
  /** unix seconds */
  posted: z.number().int(),
  /** integer milliunits (value * 1000) */
  amount: z.number().int(),
  description: z.string(),
  externalId: z.string().startsWith('import:')
})
export type NormalizedImportRow = z.infer<typeof normalizedImportRowSchema>

// candidate date-fns formats, most-specific and US-first (ambiguous d/M vs M/d
// resolves to US unless some value has day > 12, which fails the US parse).
// 2-digit-year formats precede 4-digit ones: 'yy' rejects 4-digit input but
// 'yyyy' silently accepts "04" as year 4, so yy must get first try. Shared so
// the mapping UI can offer the same list inference draws from.
export const CSV_DATE_FORMATS = [
  'yyyy-MM-dd',
  'M/d/yy',
  'd/M/yy',
  'M/d/yyyy',
  'd/M/yyyy',
  'M-d-yyyy',
  'd-M-yyyy',
  'yyyy/M/d',
  'MMM d, yyyy',
  'd MMM yyyy',
  'MMMM d, yyyy'
] as const

// CSV column roles, by column index (headers can repeat; indexes can't).
// Amounts are either one signed column or separate debit/credit columns.
export const csvMappingSchema = z.object({
  dateColumn: z.number().int().nonnegative(),
  /** date-fns format string, e.g. 'MM/dd/yyyy' */
  dateFormat: z.string().min(1),
  descriptionColumn: z.number().int().nonnegative(),
  amount: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('single'),
      column: z.number().int().nonnegative(),
      /**
       * Flip the sign of every amount. Some banks use the opposite convention
       * from this app (money out positive), which makes the whole file read
       * backwards; inverting fixes it without touching the relative direction
       * of any row, so a file with both signs stays coherent.
       */
      invert: z.boolean().default(false)
    }),
    z.object({
      kind: z.literal('debitCredit'),
      debitColumn: z.number().int().nonnegative(),
      creditColumn: z.number().int().nonnegative()
    })
  ])
})
export type CsvMapping = z.infer<typeof csvMappingSchema>

// pickFile output. The parsed file stays in main under `handle` (ofx/qfx/qif
// parse fully there; csv waits for a mapping step, so it comes with a
// best-guess mapping), and preview/apply refer back to it, so only a sample and
// the count cross IPC here. null = canceled
export type PickFileResult =
  | { kind: 'rows'; handle: string; fileName: string; format: 'ofx' | 'qif'; rowCount: number }
  | {
      kind: 'csv'
      handle: string
      fileName: string
      headers: string[]
      /** the first few raw data rows, for matching columns by sight */
      sampleRows: string[][]
      rowCount: number
      suggestedMapping: CsvMapping | null
    }
  | null

export const importPreviewInputSchema = z.object({
  handle: z.string(),
  /** required for a csv file, ignored otherwise */
  mapping: csvMappingSchema.optional(),
  /** existing target account; omitted for a new account (no duplicates possible) */
  accountId: z.number().int().optional()
})
export type ImportPreviewInput = z.infer<typeof importPreviewInputSchema>

/**
 * duplicate — externalId already exists live in the target account (never
 *             importable). A soft-deleted match is importable: applying restores
 *             that row rather than inserting a second one.
 * probable  — an existing row has the same posted day + amount (opt-in)
 */
export type ImportRowStatus = 'new' | 'duplicate' | 'probable'

export interface ImportPreview {
  rows: (NormalizedImportRow & { status: ImportRowStatus })[]
  /** rows that failed to normalize, by 1-based data-row line */
  errors: { line: number; message: string }[]
}

export const importApplyInputSchema = z.object({
  handle: z.string(),
  mapping: csvMappingSchema.optional(),
  /** externalIds of importable rows the user unchecked; exact duplicates are always skipped */
  excluded: z.array(z.string()),
  target: z.union([
    z.object({ accountId: z.number().int() }),
    z.object({
      newAccount: z.object({
        name: z.string().trim().min(1),
        currency: z.string().trim().min(1),
        /** opening balance, before the imported rows; integer milliunits, defaults to 0 */
        balance: z.number().int().optional()
      })
    })
  ])
})
export type ImportApplyInput = z.infer<typeof importApplyInputSchema>

export interface ImportApplyResult {
  accountId: number
  inserted: number
  /** rows skipped by the unique-index conflict guard */
  skipped: number
  detectedTransfers: number
  rulesApplied: number
}
