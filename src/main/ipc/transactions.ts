import { ipcMain } from 'electron'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { createLogger } from '../logging'
import { categories, transactions } from '../db/schema'
import { recordAction } from './action-log'
import { detectRuleSuggestions } from './rule-suggestions'
import {
  IPC,
  transactionIdsSchema,
  transactionsSetCategoriesSchema,
  type TransactionActionChange,
  type TransactionsSetCategoriesInput,
  type TransactionStats
} from '@shared/ipc'

// pending rows are excluded from every bulk action: sync drops and re-inserts
// them (their SimpleFIN ids change when they post), so any change would be lost
const notPending = eq(transactions.pending, false)

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

const log = createLogger('transactions')

/**
 * Apply per-row category changes as one undoable action-log entry, skipping
 * pending/missing rows and no-ops; returns the number of rows actually changed.
 * Shared so LLM auto-categorize records through the same path as manual edits.
 */
export function setCategories({ changes, source }: TransactionsSetCategoriesInput): number {
  const categoryIds = [
    ...new Set(changes.map((c) => c.categoryId).filter((id): id is number => id !== null))
  ]
  if (categoryIds.length > 0) {
    const found = db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, categoryIds))
      .all()
    if (found.length !== categoryIds.length) throw new Error('Category not found')
  }
  const logged = db.transaction((tx) => {
    const ids = changes.map((c) => c.transactionId)
    // current categories for the non-pending targets, so undo can restore each
    const before = new Map(
      tx
        .select({ id: transactions.id, categoryId: transactions.categoryId })
        .from(transactions)
        .where(and(inArray(transactions.id, ids), notPending))
        .all()
        .map((r) => [r.id, r.categoryId])
    )
    const logged: TransactionActionChange[] = []
    for (const { transactionId, categoryId } of changes) {
      if (!before.has(transactionId)) continue // missing or pending: skip
      const prev = before.get(transactionId)!
      if (prev === categoryId) continue // no-op
      tx.update(transactions).set({ categoryId }).where(eq(transactions.id, transactionId)).run()
      logged.push({ transactionId, field: 'categoryId', before: prev, after: categoryId })
    }
    if (logged.length > 0) {
      recordAction(tx, {
        source: source ?? 'user',
        label: `Set category on ${plural(logged.length, 'transaction')}`,
        changes: logged
      })
    }
    return logged
  })

  // turn repeated identical categorizations into a rule suggestion — after the
  // commit and off the response path, so it can never delay or fail the write
  const categorized = logged.flatMap((c) =>
    typeof c.after === 'number' ? [{ transactionId: c.transactionId, categoryId: c.after }] : []
  )
  if (categorized.length > 0) {
    setImmediate(() => {
      detectRuleSuggestions(categorized, source === 'llm' ? 'llm' : 'user').catch((e) => {
        log.error('rule-suggestion-detection.failed', e)
      })
    })
  }
  return logged.length
}

export function registerTransactionsIpc(): void {
  // one pass over the visible rows: how many exist and how many are still
  // uncategorized (category_id IS NULL — transfers/income are non-null system
  // categories, so they don't count). Drives the chat's "too many uncategorized"
  // warning; the categorize mutation invalidates queries, so it refetches on its own.
  ipcMain.handle(IPC.transactionsStats, (): TransactionStats => {
    const row = db
      .select({
        total: sql<number>`count(*)`,
        uncategorized: sql<number>`count(case when ${transactions.categoryId} is null then 1 end)`
      })
      .from(transactions)
      .where(isNull(transactions.deletedAt))
      .get()
    return { total: row?.total ?? 0, uncategorized: row?.uncategorized ?? 0 }
  })

  ipcMain.handle(IPC.transactionsSetCategories, (_event, input: unknown) =>
    setCategories(transactionsSetCategoriesSchema.parse(input))
  )

  ipcMain.handle(IPC.transactionsBulkDelete, (_event, input: unknown) => {
    const { transactionIds } = transactionIdsSchema.parse(input)
    const now = Math.floor(Date.now() / 1000)
    return db.transaction((tx) => {
      const rows = tx
        .update(transactions)
        .set({ deletedAt: now })
        .where(
          and(inArray(transactions.id, transactionIds), notPending, isNull(transactions.deletedAt))
        )
        .returning({ id: transactions.id })
        .all()
      if (rows.length > 0) {
        recordAction(tx, {
          source: 'user',
          label: `Delete ${plural(rows.length, 'transaction')}`,
          changes: rows.map((r) => ({
            transactionId: r.id,
            field: 'deletedAt',
            before: null,
            after: now
          }))
        })
      }
      return rows.map((r) => r.id)
    })
  })
}
