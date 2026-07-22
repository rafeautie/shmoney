import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { createLogger } from '../logging'
import { accounts, categories, transactions } from '../db/schema'
import { dayToUnix } from '../import/parse'
import { recordAction } from './action-log'
import { detectRuleSuggestions } from './rule-suggestions'
import {
  buildUpdateChanges,
  IPC,
  isSyncOwned,
  transactionCreateSchema,
  transactionIdsSchema,
  transactionsSetCategoriesSchema,
  transactionUpdateSchema,
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

  ipcMain.handle(IPC.transactionsCreate, (_event, input: unknown) => {
    const { accountId, amount, description, date, categoryId } =
      transactionCreateSchema.parse(input)

    const account = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get()
    if (!account) throw new Error('Account not found')
    if (categoryId !== null) {
      const category = db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .get()
      if (!category) throw new Error('Category not found')
    }

    // a calendar day anchored at local noon, the same convention file import uses
    const [year, month, day] = date.split('-').map(Number)
    const posted = dayToUnix(year, month, day)
    const now = Math.floor(Date.now() / 1000)

    return db.transaction((tx) => {
      // the `manual:` prefix keeps this synthetic id clear of the sync and import
      // id spaces, so it can't collide on the (account, simplefin_id) unique index
      const inserted = tx
        .insert(transactions)
        .values({
          accountId,
          simplefinId: `manual:${randomUUID()}`,
          posted,
          amount,
          description,
          pending: false,
          categoryId
        })
        .returning({ id: transactions.id })
        .get()
      // record as a deletedAt change (before=now, after=null) so undo soft-deletes
      // the row and redo restores it — the same encoding file import uses for inserts
      recordAction(tx, {
        source: 'user',
        label: `Created “${description}”`,
        changes: [{ transactionId: inserted.id, field: 'deletedAt', before: now, after: null }]
      })
      return inserted.id
    })
  })

  ipcMain.handle(IPC.transactionsUpdate, (_event, input: unknown) => {
    const { id, amount, description, date, categoryId } = transactionUpdateSchema.parse(input)

    const row = db
      .select({
        amount: transactions.amount,
        description: transactions.description,
        posted: transactions.posted,
        pending: transactions.pending,
        categoryId: transactions.categoryId,
        deletedAt: transactions.deletedAt,
        simplefinId: transactions.simplefinId,
        connectionId: accounts.connectionId
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(transactions.id, id))
      .get()
    if (!row || row.deletedAt !== null) throw new Error('Transaction not found')
    if (row.pending) throw new Error("Pending transactions can't be edited")
    // the UI disables these fields on sync-owned rows; this is the backstop so a
    // stale or hand-crafted call can't write values the next sync would clobber
    if (
      isSyncOwned(row.connectionId, row.simplefinId) &&
      (amount !== undefined || description !== undefined || date !== undefined)
    ) {
      throw new Error('Only the category can be edited on synced transactions')
    }
    if (categoryId !== undefined && categoryId !== null) {
      const category = db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .get()
      if (!category) throw new Error('Category not found')
    }

    // same local-noon anchoring as create
    let posted: number | undefined
    if (date !== undefined) {
      const [year, month, day] = date.split('-').map(Number)
      posted = dayToUnix(year, month, day)
    }

    const changes = buildUpdateChanges(row, { amount, description, posted, categoryId }, id)
    if (changes.length === 0) return 0

    db.transaction((tx) => {
      const set: Partial<{
        amount: number
        description: string
        posted: number
        categoryId: number | null
      }> = {}
      for (const change of changes) {
        if (change.field === 'description') set.description = change.after
        else if (change.field === 'amount') set.amount = change.after as number
        else if (change.field === 'posted') set.posted = change.after as number
        else if (change.field === 'categoryId') set.categoryId = change.after
      }
      tx.update(transactions).set(set).where(eq(transactions.id, id)).run()
      recordAction(tx, {
        source: 'user',
        label: `Edited “${set.description ?? row.description}”`,
        changes
      })
    })

    // editor categorization feeds rule suggestions like cell categorization does
    const newCategoryId = changes.find((c) => c.field === 'categoryId')?.after
    if (typeof newCategoryId === 'number') {
      setImmediate(() => {
        detectRuleSuggestions([{ transactionId: id, categoryId: newCategoryId }], 'user').catch(
          (e) => {
            log.error('rule-suggestion-detection.failed', e)
          }
        )
      })
    }
    return changes.length
  })
}
