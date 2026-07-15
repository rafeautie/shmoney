import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { accounts, transactions } from '../db/schema'
import { decodeBuffer, sniffFormat, parseOfx, parseQif } from '../import/parse'
import { parseCsv, detectCsvMapping, normalizeCsvRows } from '../import/csv'
import { assignExternalIds, annotateDuplicates } from '../import/dedupe'
import {
  applyRulesOnSyncEnabled,
  detectAndMarkTransfersInTx,
  detectTransfersEnabled
} from './connections'
import { applyRulesInTx } from './rules'
import { recordAction } from './action-log'
import {
  IMPORT_IPC,
  importApplyInputSchema,
  importPreviewInputSchema,
  type ImportApplyResult,
  type ImportPreview,
  type PickFileResult
} from '@shared/import'

// `dropped` carries a drag-and-dropped file's bytes from the renderer (decoded
// here so the windows-1252 fallback applies). `filePath` is a dev-only bypass
// of the native dialog for automated verification (mirrors registerDebugIpc).
const pickFileInputSchema = z
  .object({
    filePath: z.string().optional(),
    dropped: z
      .object({ fileName: z.string(), bytes: z.instanceof(Uint8Array) })
      .optional()
  })
  .optional()

const FILE_FILTERS = [
  { name: 'Transaction files', extensions: ['csv', 'tsv', 'ofx', 'qfx', 'qif'] },
  { name: 'All files', extensions: ['*'] }
]

async function pickFileBytes(input: unknown): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const parsed = pickFileInputSchema.parse(input)
  if (parsed?.dropped) return parsed.dropped
  if (is.dev && parsed?.filePath) {
    return { fileName: basename(parsed.filePath), bytes: readFileSync(parsed.filePath) }
  }
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILE_FILTERS })
  if (result.canceled || result.filePaths.length === 0) return null
  return { fileName: basename(result.filePaths[0]), bytes: readFileSync(result.filePaths[0]) }
}

export function registerImportIpc(): void {
  ipcMain.handle(IMPORT_IPC.pickFile, async (_event, input: unknown): Promise<PickFileResult> => {
    const picked = await pickFileBytes(input)
    if (!picked) return null

    const { fileName } = picked
    const text = decodeBuffer(picked.bytes)
    const format = sniffFormat(fileName, text)
    if (format === 'csv') {
      const { headers, rows } = parseCsv(text)
      return { kind: 'csv', fileName, headers, rows, suggestedMapping: detectCsvMapping(headers, rows) }
    }
    const parsed = format === 'ofx' ? parseOfx(text) : parseQif(text)
    return { kind: 'rows', fileName, format, rows: assignExternalIds(parsed) }
  })

  ipcMain.handle(IMPORT_IPC.preview, (_event, input: unknown): ImportPreview => {
    const { source, accountId } = importPreviewInputSchema.parse(input)

    let rows, errors
    if ('rows' in source) {
      rows = source.rows
      errors = [] as { line: number; message: string }[]
    } else {
      const normalized = normalizeCsvRows(source.csv.rows, source.csv.mapping)
      rows = assignExternalIds(normalized.rows)
      errors = normalized.errors
    }

    if (accountId === undefined) {
      // a brand-new account has nothing to be a duplicate of
      return { rows: rows.map((r) => ({ ...r, status: 'new' as const })), errors }
    }
    // soft-deleted rows included: the unique index still holds them, so an
    // insert against their id would skip
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
    return { rows: annotateDuplicates(rows, existing), errors }
  })

  ipcMain.handle(IMPORT_IPC.apply, (_event, input: unknown): ImportApplyResult => {
    const { rows, target } = importApplyInputSchema.parse(input)
    const now = Math.floor(Date.now() / 1000)
    const detectEnabled = detectTransfersEnabled()
    const rulesEnabled = applyRulesOnSyncEnabled()

    return db.transaction((tx) => {
      let accountId: number
      let accountName: string
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
        // never touches it and disconnect's cascade leaves it alone
        const account = tx
          .insert(accounts)
          .values({
            connectionId: null,
            simplefinId: null,
            institutionName: null,
            name: target.newAccount.name,
            currency: target.newAccount.currency,
            balance: target.newAccount.balance ?? 0,
            balanceDate: now
          })
          .returning({ id: accounts.id, name: accounts.name })
          .get()
        accountId = account.id
        accountName = account.name
      }

      // never writes categoryId/deletedAt (user-owned columns), and never
      // updates on conflict: an import must not clobber existing rows or
      // resurrect soft-deleted ones
      const insertedIds: number[] = []
      for (const row of rows) {
        const inserted = tx
          .insert(transactions)
          .values({
            accountId,
            simplefinId: row.externalId,
            posted: row.posted,
            amount: row.amount,
            description: row.description,
            pending: false
          })
          .onConflictDoNothing({ target: [transactions.accountId, transactions.simplefinId] })
          .returning({ id: transactions.id })
          .get()
        if (inserted) insertedIds.push(inserted.id)
      }

      if (insertedIds.length > 0) {
        // undo soft-deletes exactly these rows (sets deletedAt = `before`,
        // guarded on it still being null); redo restores them. NOTE: a
        // SimpleFIN disconnect clears the action log while manual accounts
        // survive, orphaning this entry — accepted wrinkle.
        recordAction(tx, {
          source: 'import',
          label: `Imported ${insertedIds.length} transaction${insertedIds.length === 1 ? '' : 's'} into ${accountName}`,
          changes: insertedIds.map((id) => ({
            transactionId: id,
            field: 'deletedAt',
            before: now,
            after: null
          }))
        })
      }

      const detectedTransfers =
        insertedIds.length > 0 && detectEnabled ? detectAndMarkTransfersInTx(tx) : 0
      const rulesApplied =
        insertedIds.length > 0 && rulesEnabled ? applyRulesInTx(tx).categorized : 0

      return {
        accountId,
        inserted: insertedIds.length,
        skipped: rows.length - insertedIds.length,
        detectedTransfers,
        rulesApplied
      }
    })
  })
}
