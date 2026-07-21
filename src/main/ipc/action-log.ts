import { ipcMain } from 'electron'
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { accounts, actionLog, budgets, categories, conversations, transactions } from '../db/schema'
import { dominantCurrency } from '../budgets/summary'
import { createLogger } from '../logging'
import { transactionDate } from './transactions-page'
import {
  ACTION_LOG_IPC,
  idSchema,
  type ActionChange,
  type ActionField,
  type ActionLogEntry,
  type ActionSource,
  type BudgetActionChange,
  type ConversationActionChange,
  type TransactionActionChange,
  type UndoResult
} from '@shared/ipc'

// the drizzle transaction handle passed to db.transaction() callbacks
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const log = createLogger('action-log')

// the only columns undo/redo may rewrite. Keys match ActionField (and the
// drizzle schema props), so a change can never target an arbitrary column.
const EDITABLE_FIELDS = {
  categoryId: transactions.categoryId,
  deletedAt: transactions.deletedAt
} as const

// how many recent entries the Activity page shows (undo/redo still reach older
// rows by id; this only bounds the list payload)
const LIST_LIMIT = 200

// applied entries (undoneAt null) are the permanent Activity history and are
// never purged. An entry the user undid and left undone, though, is dead weight
// once it's old: redo is session-scoped, so a months-old undone entry won't be
// redone and only bloats the table. This window keeps recent undos redoable
// across a restart while letting the clearly-abandoned ones go.
const UNDONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

// newest entry id at launch. Keyboard undo/redo only reach entries created after
// this, so a stray Ctrl+Z can't rewind a previous session's work. Set once when
// the IPC is registered at startup.
let sessionBaselineId = 0

/**
 * Append an entry to the audit log within an existing transaction. Callers pass
 * only the changes that actually altered a row, so an entry always has effect.
 * Returns the new entry id.
 */
export function recordAction(
  tx: Tx,
  entry: { source: ActionSource; label: string; changes: ActionChange[] }
): number {
  const row = tx
    .insert(actionLog)
    .values({
      createdAt: Date.now(),
      source: entry.source,
      label: entry.label,
      changes: entry.changes
    })
    .returning({ id: actionLog.id })
    .get()
  return row.id
}

// null-safe equality against the current stored value
function currentValueIs(field: ActionField, value: number | null): SQL {
  const col = EDITABLE_FIELDS[field]
  if (value === null) return isNull(col)
  return sql`${col} = ${value}`
}

// write one field on one row, but only if it still holds the value this action
// last set it to (the guard). A row edited since is "superseded" and skipped.
function setGuarded(
  tx: Tx,
  field: ActionField,
  transactionId: number,
  target: number | null,
  guard: number | null
): number {
  const where = and(eq(transactions.id, transactionId), currentValueIs(field, guard))
  switch (field) {
    case 'categoryId':
      return tx.update(transactions).set({ categoryId: target }).where(where).run().changes
    case 'deletedAt':
      return tx.update(transactions).set({ deletedAt: target }).where(where).run().changes
  }
}

// same guarded semantics for a budget fill row, where null means "no row":
// delete only if the amount is still the guard, insert only if still absent,
// update only from the guarded amount. Superseded states are skipped.
function setBudgetGuarded(
  tx: Tx,
  change: BudgetActionChange,
  target: number | null,
  guard: number | null
): number {
  const key = and(eq(budgets.categoryId, change.categoryId), eq(budgets.month, change.month))
  if (target === null) {
    if (guard === null) return 0
    return tx
      .delete(budgets)
      .where(and(key, eq(budgets.amount, guard)))
      .run().changes
  }
  if (guard === null) {
    // the category may have been deleted since (fills cascade away); skip then
    const cat = tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, change.categoryId))
      .get()
    if (!cat) return 0
    return tx
      .insert(budgets)
      .values({ categoryId: change.categoryId, month: change.month, amount: target })
      .onConflictDoNothing()
      .run().changes
  }
  return tx
    .update(budgets)
    .set({ amount: target })
    .where(and(key, eq(budgets.amount, guard)))
    .run().changes
}

// same guarded semantics for a conversation's title or soft-delete timestamp.
// target/guard are computed here (not in applyEntry) so each variant's types
// stay homogeneous: title is string, deletedAt is a number.
function setConversationGuarded(
  tx: Tx,
  change: ConversationActionChange,
  direction: 'undo' | 'redo'
): number {
  if (change.field === 'conversationTitle') {
    const target = direction === 'undo' ? change.before : change.after
    const guard = direction === 'undo' ? change.after : change.before
    const where = and(
      eq(conversations.id, change.conversationId),
      guard === null ? isNull(conversations.title) : sql`${conversations.title} = ${guard}`
    )
    return tx.update(conversations).set({ title: target }).where(where).run().changes
  }
  const target = direction === 'undo' ? change.before : change.after
  const guard = direction === 'undo' ? change.after : change.before
  const where = and(
    eq(conversations.id, change.conversationId),
    guard === null ? isNull(conversations.deletedAt) : sql`${conversations.deletedAt} = ${guard}`
  )
  return tx.update(conversations).set({ deletedAt: target }).where(where).run().changes
}

// undo rewinds each field to `before` (guarding on `after`); redo does the
// reverse. Either way the guard makes it a no-op on rows touched since, so an
// old entry can never clobber newer edits. Returns rows actually changed.
function applyEntry(entryId: number, direction: 'undo' | 'redo'): UndoResult {
  return db.transaction((tx) => {
    const entry = tx.select().from(actionLog).where(eq(actionLog.id, entryId)).get()
    if (!entry) throw new Error('Action not found')

    let applied = 0
    for (const change of entry.changes) {
      if (change.field === 'budgetAmount') {
        const target = direction === 'undo' ? change.before : change.after
        const guard = direction === 'undo' ? change.after : change.before
        applied += setBudgetGuarded(tx, change, target, guard)
      } else if (change.field === 'conversationTitle' || change.field === 'conversationDeletedAt') {
        applied += setConversationGuarded(tx, change, direction)
      } else {
        const target = direction === 'undo' ? change.before : change.after
        const guard = direction === 'undo' ? change.after : change.before
        applied += setGuarded(tx, change.field, change.transactionId, target, guard)
      }
    }

    tx.update(actionLog)
      .set({ undoneAt: direction === 'undo' ? Date.now() : null })
      .where(eq(actionLog.id, entryId))
      .run()

    return { id: entryId, label: entry.label, applied }
  })
}

// Ctrl+Z / Ctrl+Y are deliberately narrow: they reach only your own actions
// (source 'user') from the current session (id past the launch baseline), so a
// stray keystroke on any page can't rewind automated changes or a previous
// session's work — those stay reversible from the Activity page. Undo takes the
// newest still-applied such entry; redo the most recently undone one. Redo isn't
// cleared by new work, and applyEntry's guard keeps re-applying an old entry safe.
function userSessionScope(): SQL {
  return and(eq(actionLog.source, 'user'), gt(actionLog.id, sessionBaselineId)) as SQL
}

function undoNewest(): UndoResult | null {
  const entry = db
    .select({ id: actionLog.id })
    .from(actionLog)
    .where(and(userSessionScope(), isNull(actionLog.undoneAt)))
    .orderBy(desc(actionLog.id))
    .limit(1)
    .get()
  return entry ? applyEntry(entry.id, 'undo') : null
}

function redoNewest(): UndoResult | null {
  const entry = db
    .select({ id: actionLog.id })
    .from(actionLog)
    .where(and(userSessionScope(), isNotNull(actionLog.undoneAt)))
    .orderBy(desc(actionLog.undoneAt), desc(actionLog.id))
    .limit(1)
    .get()
  return entry ? applyEntry(entry.id, 'redo') : null
}

// the most recent entries, each change joined to its current context: a
// transaction change to its transaction (null when later removed, e.g. on
// disconnect), a budget change to its category name
function listEntries(): ActionLogEntry[] {
  const rows = db.select().from(actionLog).orderBy(desc(actionLog.id)).limit(LIST_LIMIT).all()
  const allChanges = rows.flatMap((r) => r.changes)
  const txIds = [
    ...new Set(
      allChanges
        .filter(
          (c): c is TransactionActionChange => c.field === 'categoryId' || c.field === 'deletedAt'
        )
        .map((c) => c.transactionId)
    )
  ]
  const context = txIds.length
    ? db
        .select({
          id: transactions.id,
          description: transactions.description,
          accountName: accounts.name,
          amount: transactions.amount,
          currency: accounts.currency,
          date: transactionDate
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(inArray(transactions.id, txIds))
        .all()
    : []
  const byId = new Map(context.map((c) => [c.id, c]))

  const budgetCatIds = [
    ...new Set(
      allChanges
        .filter((c): c is BudgetActionChange => c.field === 'budgetAmount')
        .map((c) => c.categoryId)
    )
  ]
  const budgetCats = budgetCatIds.length
    ? db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, budgetCatIds))
        .all()
    : []
  const catById = new Map(budgetCats.map((c) => [c.id, c.name]))
  const currency = budgetCatIds.length ? dominantCurrency() : 'USD'

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    source: row.source as ActionSource,
    label: row.label,
    undoneAt: row.undoneAt,
    changes: row.changes.map((change) => {
      if (change.field === 'budgetAmount') {
        return { ...change, categoryName: catById.get(change.categoryId) ?? null, currency }
      }
      if (change.field === 'conversationTitle' || change.field === 'conversationDeletedAt') {
        return change
      }
      const t = byId.get(change.transactionId)
      return {
        ...change,
        description: t?.description ?? null,
        accountName: t?.accountName ?? null,
        amount: t?.amount ?? null,
        currency: t?.currency ?? null,
        date: t?.date ?? null
      }
    })
  }))
}

// compact the log at startup: drop entries that have sat undone longer than the
// retention window. Applied history stays intact — only abandoned undos go.
function purgeStaleUndoneEntries(): void {
  const cutoff = Date.now() - UNDONE_RETENTION_MS
  const removed = db
    .delete(actionLog)
    .where(and(isNotNull(actionLog.undoneAt), lt(actionLog.undoneAt, cutoff)))
    .run().changes
  if (removed > 0) log.info('action-log.purged-stale-undone', { count: removed })
}

export function registerActionLogIpc(): void {
  purgeStaleUndoneEntries()

  // snapshot the newest entry so keyboard undo/redo can tell this session's
  // actions apart from earlier ones
  const newest = db
    .select({ id: actionLog.id })
    .from(actionLog)
    .orderBy(desc(actionLog.id))
    .limit(1)
    .get()
  sessionBaselineId = newest?.id ?? 0

  ipcMain.handle(ACTION_LOG_IPC.list, () => listEntries())
  ipcMain.handle(ACTION_LOG_IPC.undo, () => undoNewest())
  ipcMain.handle(ACTION_LOG_IPC.redo, () => redoNewest())
  ipcMain.handle(ACTION_LOG_IPC.undoEntry, (_event, input: unknown) =>
    applyEntry(idSchema.parse(input), 'undo')
  )
  ipcMain.handle(ACTION_LOG_IPC.redoEntry, (_event, input: unknown) =>
    applyEntry(idSchema.parse(input), 'redo')
  )
}
