import { ipcMain } from 'electron'
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { accounts, actionLog, transactions } from '../db/schema'
import { transactionDate } from './transactions-page'
import {
  ACTION_LOG_IPC,
  idSchema,
  type ActionChange,
  type ActionField,
  type ActionLogEntry,
  type ActionSource,
  type UndoResult
} from '@shared/ipc'

// the drizzle transaction handle passed to db.transaction() callbacks
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// the only columns undo/redo may rewrite. Keys match ActionField (and the
// drizzle schema props), so a change can never target an arbitrary column.
const EDITABLE_FIELDS = {
  categoryId: transactions.categoryId,
  deletedAt: transactions.deletedAt,
  isTransfer: transactions.isTransfer
} as const

// how many recent entries the Activity page shows (undo/redo still reach older
// rows by id; this only bounds the list payload)
const LIST_LIMIT = 200

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
    .values({ createdAt: Date.now(), source: entry.source, label: entry.label, changes: entry.changes })
    .returning({ id: actionLog.id })
    .get()
  return row.id
}

// null-safe equality against the current stored value; booleans compare as 0/1
function currentValueIs(field: ActionField, value: ActionChange['before']): SQL {
  const col = EDITABLE_FIELDS[field]
  if (value === null) return isNull(col)
  const raw = typeof value === 'boolean' ? (value ? 1 : 0) : value
  return sql`${col} = ${raw}`
}

// write one field on one row, but only if it still holds the value this action
// last set it to (the guard). A row edited since is "superseded" and skipped.
function setGuarded(
  tx: Tx,
  field: ActionField,
  transactionId: number,
  target: ActionChange['before'],
  guard: ActionChange['before']
): number {
  const where = and(eq(transactions.id, transactionId), currentValueIs(field, guard))
  switch (field) {
    case 'categoryId':
      return tx.update(transactions).set({ categoryId: target as number | null }).where(where).run()
        .changes
    case 'deletedAt':
      return tx.update(transactions).set({ deletedAt: target as number | null }).where(where).run()
        .changes
    case 'isTransfer':
      return tx.update(transactions).set({ isTransfer: target as boolean }).where(where).run().changes
  }
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
      const target = direction === 'undo' ? change.before : change.after
      const guard = direction === 'undo' ? change.after : change.before
      applied += setGuarded(tx, change.field, change.transactionId, target, guard)
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

// the most recent entries, each change joined to its transaction's current
// context (null when that transaction was later removed, e.g. on disconnect)
function listEntries(): ActionLogEntry[] {
  const rows = db.select().from(actionLog).orderBy(desc(actionLog.id)).limit(LIST_LIMIT).all()
  const txIds = [...new Set(rows.flatMap((r) => r.changes.map((c) => c.transactionId)))]
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

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    source: row.source as ActionSource,
    label: row.label,
    undoneAt: row.undoneAt,
    changes: row.changes.map((change) => {
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

export function registerActionLogIpc(): void {
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
