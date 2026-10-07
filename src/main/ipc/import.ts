import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { accounts, transactions } from '../db/schema'
import { systemCategoryIdSql } from '../db/system-categories'
import { decodeBuffer, sniffFormat, parseOfx, parseQif } from '../import/parse'
import { parseCsv, detectCsvMapping, normalizeCsvRows } from '../import/csv'
import { assignExternalIds, annotateDuplicates } from '../import/dedupe'
import {
  applyRulesOnSyncEnabled,
  detectAndMarkTransfersInTx,
  detectTransfersEnabled
} from './connections'
import { applyRulesInTx } from './rules'
import { inRun, newRun, recordAction } from './action-log'
import { createLogger } from '../logging'
import {
  IMPORT_IPC,
  importApplyInputSchema,
  importPreviewInputSchema,
  type CsvMapping,
  type ImportApplyResult,
  type ImportPreview,
  type NormalizedImportRow,
  type PickFileResult
} from '@shared/import'

// `dropped` carries a drag-and-dropped file's bytes from the renderer (decoded
// here so the windows-1252 fallback applies). `filePath` is a dev-only bypass
// of the native dialog for automated verification (mirrors registerDebugIpc).
const pickFileInputSchema = z
  .object({
    filePath: z.string().optional(),
    dropped: z.object({ fileName: z.string(), bytes: z.instanceof(Uint8Array) }).optional()
  })
  .optional()

const log = createLogger('import')

const FILE_FILTERS = [
  { name: 'Transaction files', extensions: ['csv', 'tsv', 'ofx', 'qfx', 'qif'] },
  { name: 'All files', extensions: ['*'] }
]

/** raw rows the column-matching step shows as a sample */
const CSV_SAMPLE_ROWS = 3

type Normalized = { rows: NormalizedImportRow[]; errors: { line: number; message: string }[] }

// A picked file, parsed once and kept here so preview and apply refer to it by
// handle instead of shipping every row back and forth over IPC. csv keeps the
// raw table plus the last mapping's normalized rows (preview then apply reuse it).
type PickedFile =
  | { kind: 'rows'; normalized: Normalized }
  | { kind: 'csv'; rows: string[][]; normalizedFor?: { key: string; result: Normalized } }

const pickedFiles = new Map<string, PickedFile>()

function normalizedRows(handle: string, mapping: CsvMapping | undefined): Normalized {
  const file = pickedFiles.get(handle)
  if (!file) throw new Error('The import file is no longer loaded; pick it again')
  if (file.kind === 'rows') return file.normalized
  if (!mapping) throw new Error('A column mapping is required for CSV files')
  const key = JSON.stringify(mapping)
  if (file.normalizedFor?.key !== key) {
    const normalized = normalizeCsvRows(file.rows, mapping)
    file.normalizedFor = {
      key,
      result: { rows: assignExternalIds(normalized.rows), errors: normalized.errors }
    }
  }
  return file.normalizedFor.result
}

async function pickFileBytes(
  input: unknown
): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const parsed = pickFileInputSchema.parse(input)
  if (parsed?.dropped) return parsed.dropped
  if (is.dev && parsed?.filePath) {
    return { fileName: basename(parsed.filePath), bytes: readFileSync(parsed.filePath) }
  }
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILE_FILTERS })
  if (result.canceled || result.filePaths.length === 0) return null
  return { fileName: basename(result.filePaths[0]), bytes: readFileSync(result.filePaths[0]) }
}

// soft-deleted rows included: they hold the unique key, so applying restores
// them instead of inserting (annotateDuplicates decides what that means)
function annotate(
  rows: NormalizedImportRow[],
  accountId: number | undefined
): ImportPreview['rows'] {
  if (accountId === undefined) {
    // a brand-new account has nothing to be a duplicate of
    return rows.map((r) => ({ ...r, status: 'new' as const }))
  }
  const existing = db
    .select({
      simplefinId: transactions.simplefinId,
      posted: transactions.posted,
      amount: transactions.amount,
      deletedAt: transactions.deletedAt
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .all()
  return annotateDuplicates(rows, existing)
}

export function registerImportIpc(): void {
  ipcMain.handle(IMPORT_IPC.pickFile, async (_event, input: unknown): Promise<PickFileResult> => {
    const picked = await pickFileBytes(input)
    if (!picked) return null
    // one import dialog at a time: a new pick supersedes whatever was loaded
    pickedFiles.clear()

    const { fileName } = picked
    const text = decodeBuffer(picked.bytes)
    const format = sniffFormat(fileName, text)
    const handle = randomUUID()
    if (format === 'csv') {
      const { headers, rows } = await parseCsv(text)
      pickedFiles.set(handle, { kind: 'csv', rows })
      return {
        kind: 'csv',
        handle,
        fileName,
        headers,
        sampleRows: rows.slice(0, CSV_SAMPLE_ROWS),
        rowCount: rows.length,
        suggestedMapping: detectCsvMapping(headers, rows)
      }
    }
    const parsed = format === 'ofx' ? await parseOfx(text) : await parseQif(text)
    const rows = assignExternalIds(parsed)
    pickedFiles.set(handle, { kind: 'rows', normalized: { rows, errors: [] } })
    return { kind: 'rows', handle, fileName, format, rowCount: rows.length }
  })

  ipcMain.handle(IMPORT_IPC.release, (_event, input: unknown): boolean => {
    pickedFiles.delete(z.string().parse(input))
    return true
  })

  ipcMain.handle(IMPORT_IPC.preview, (_event, input: unknown): ImportPreview => {
    const { handle, mapping, accountId } = importPreviewInputSchema.parse(input)
    const { rows, errors } = normalizedRows(handle, mapping)
    return { rows: annotate(rows, accountId), errors }
  })

  ipcMain.handle(IMPORT_IPC.apply, (_event, input: unknown): ImportApplyResult => {
    const { handle, mapping, excluded, target } = importApplyInputSchema.parse(input)
    const excludedIds = new Set(excluded)
    // the same selection the preview showed: every row but exact duplicates
    // and the ones the user unchecked
    const rows = annotate(
      normalizedRows(handle, mapping).rows,
      'accountId' in target ? target.accountId : undefined
    ).filter((r) => r.status !== 'duplicate' && !excludedIds.has(r.externalId))
    if (rows.length === 0) throw new Error('No rows selected')

    const now = Math.floor(Date.now() / 1000)
    const detectEnabled = detectTransfersEnabled()
    const rulesEnabled = applyRulesOnSyncEnabled()

    const result = inRun(newRun('import', 'Import from file'), () =>
      db.transaction((tx) => {
        let accountId: number
        let accountName: string
        let openingId: number | undefined
        if ('accountId' in target) {
          const account = tx
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(eq(accounts.id, target.accountId))
            .get()
          if (!account) throw new Error('Account not found')
          accountId = account.id
          accountName = account.name
        } else {
          // null connectionId/simplefinId marks the account as manual: sync
          // never touches it and disconnect's cascade leaves it alone.
          // A manual account carries no anchor — it has complete history by
          // construction, so its balance is just the sum of its transactions and
          // the opening balance is the first of them (see main/accounts/balance.ts)
          const account = tx
            .insert(accounts)
            .values({
              connectionId: null,
              simplefinId: null,
              institutionName: null,
              name: target.newAccount.name,
              currency: target.newAccount.currency,
              balance: 0,
              balanceDate: 0
            })
            .returning({ id: accounts.id, name: accounts.name })
            .get()
          accountId = account.id
          accountName = account.name

          const opening = target.newAccount.balance ?? 0
          if (opening !== 0) {
            // a day before the earliest imported row, so it sorts first. It's an
            // ordinary transaction from here on: editable, deletable, undoable.
            // A loop, not Math.min(...rows): spreading a huge import overflows the stack
            let earliest = Infinity
            for (const r of rows) if (r.posted < earliest) earliest = r.posted
            openingId = tx
              .insert(transactions)
              .values({
                accountId,
                simplefinId: `manual:opening:${accountId}`,
                posted: earliest - 86400,
                amount: opening,
                description: 'Starting balance',
                categoryId: systemCategoryIdSql('opening'),
                pending: false
              })
              .returning({ id: transactions.id })
              .get().id
          }
        }

        // never writes categoryId, and never updates a live row: an import must
        // not clobber one. A soft-deleted row holding the key is different — it is
        // an undone import or a deleted transaction, and the unique index would
        // otherwise make it unimportable forever — so un-delete it in place,
        // leaving its own columns (a since-edited amount, a category) alone.
        // Both statements are prepared once and run per row.
        const insertRow = tx
          .insert(transactions)
          .values({
            accountId,
            simplefinId: sql.placeholder('externalId'),
            posted: sql.placeholder('posted'),
            amount: sql.placeholder('amount'),
            description: sql.placeholder('description'),
            pending: false
          })
          .onConflictDoNothing({ target: [transactions.accountId, transactions.simplefinId] })
          .returning({ id: transactions.id })
          .prepare()
        const restoreRow = tx
          .update(transactions)
          .set({ deletedAt: null })
          .where(
            and(
              eq(transactions.accountId, accountId),
              eq(transactions.simplefinId, sql.placeholder('externalId')),
              isNotNull(transactions.deletedAt)
            )
          )
          .returning({ id: transactions.id })
          .prepare()

        const insertedIds: number[] = []
        for (const row of rows) {
          const inserted = insertRow.get({
            externalId: row.externalId,
            posted: row.posted,
            amount: row.amount,
            description: row.description
          })
          if (inserted) {
            insertedIds.push(inserted.id)
            continue
          }
          const restored = restoreRow.get({ externalId: row.externalId })
          if (restored) insertedIds.push(restored.id)
        }

        if (insertedIds.length > 0) {
          // undo soft-deletes exactly these rows (sets deletedAt = `before`,
          // guarded on it still being null); redo restores them. The starting
          // balance goes with them; the new account itself stays, empty.
          const logged = openingId === undefined ? insertedIds : [...insertedIds, openingId]
          recordAction(tx, {
            source: 'import',
            label: `Imported ${insertedIds.length} transaction${insertedIds.length === 1 ? '' : 's'} into ${accountName}`,
            changes: logged.map((id) => ({
              transactionId: id,
              field: 'deletedAt',
              before: now,
              after: null
            }))
          })
        }

        // scoped to what this import brought in, so a big ledger isn't rescanned
        const detectedTransfers =
          insertedIds.length > 0 && detectEnabled
            ? detectAndMarkTransfersInTx(tx, { transactionIds: insertedIds })
            : 0
        const rulesApplied =
          insertedIds.length > 0 && rulesEnabled
            ? applyRulesInTx(tx, { scope: { transactionIds: insertedIds } }).categorized
            : 0

        return {
          accountId,
          inserted: insertedIds.length,
          skipped: rows.length - insertedIds.length,
          detectedTransfers,
          rulesApplied
        }
      })
    )

    // counts only, never file names, row contents, or account names
    log.info('import.complete', {
      inserted: result.inserted,
      skipped: result.skipped,
      detectedTransfers: result.detectedTransfers,
      rulesApplied: result.rulesApplied,
      newAccount: 'newAccount' in target
    })
    return result
  })
}
