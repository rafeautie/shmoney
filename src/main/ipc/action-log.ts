import { ipcMain } from 'electron'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
  type SQL
} from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { db } from '../db'
import {
  accounts,
  actionLog,
  actionLogTransactions,
  actionRuns,
  budgets,
  categories,
  conversations,
  savedFilters,
  savingsGoals,
  transactions
} from '../db/schema'
import { dominantCurrency } from '../budgets/summary'
import { createLogger } from '../logging'
import { escapeLike } from '../reports/filters'
import {
  ACTION_LOG_IPC,
  ACTION_LOG_PREVIEW_CHANGES,
  actionLogPageSchema,
  idSchema,
  isSavingsGoalChange,
  isTransactionChange,
  type ActionChange,
  type ActionDomain,
  type ActionField,
  type ActionLogChange,
  type ActionLogEntry,
  type ActionLogPage,
  type ActionLogPageInput,
  type ActionRun,
  type ActionRunTrigger,
  type ActionSource,
  type BudgetActionChange,
  type ConversationActionChange,
  type SavedFilterActionChange,
  type SavingsGoalActionChange,
  type TransactionActionChange,
  type RunUndoResult,
  type UndoResult
} from '@shared/ipc'

// the drizzle transaction handle passed to db.transaction() callbacks
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Where a save opens its transaction: the db, or an enclosing transaction so
 * the save nests as a savepoint (sql.js, the demo's driver, can't nest BEGIN).
 */
export type Runner = Pick<Tx, 'transaction'>

const log = createLogger('action-log')

// the only numeric columns undo/redo may rewrite. Keys match ActionField (and
// the drizzle schema props), so a change can never target an arbitrary column.
// description is string-valued and handled separately (setDescriptionGuarded).
const EDITABLE_FIELDS = {
  categoryId: transactions.categoryId,
  deletedAt: transactions.deletedAt,
  amount: transactions.amount,
  posted: transactions.posted
} as const

// entries per Activity page; an unfiltered page may run over to finish a run
const PAGE_SIZE = 100

// ids per IN (...) list, well under SQLite's 32766 bound-variable limit
const IN_CHUNK = 10_000

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

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

/** One trigger's entries, grouped on the Activity page. See inRun. */
export interface Run {
  trigger: ActionRunTrigger
  label: string
  /** the action_runs row, created with the run's first entry */
  id: number | null
}

export function newRun(trigger: ActionRunTrigger, label: string): Run {
  return { trigger, label, id: null }
}

// Set only for the synchronous span of inRun, so no unrelated entry can land in
// it. A trigger whose work straddles an await (AI categorize) calls inRun once
// per synchronous part with the same Run.
let activeRun: Run | null = null

/** Record every entry fn writes into run. The run row appears with the first entry, so a no-op trigger leaves none. */
export function inRun<T>(run: Run, fn: () => T): T {
  const outer = activeRun
  activeRun = run
  try {
    return fn()
  } finally {
    activeRun = outer
  }
}

// what Activity search matches a change by: the name or title it carries,
// else (via action_log_transactions) its transaction's current description
function changeName(change: ActionChange): string | null {
  if ('name' in change) return change.name
  if ('title' in change) return change.title
  return null
}

/**
 * Append an entry to the audit log within an existing transaction. Callers pass
 * only the changes that actually altered a row, so an entry always has effect.
 * Returns the new entry id.
 */
export function recordAction(
  tx: Tx,
  entry: { source: ActionSource; label: string; changes: ActionChange[] }
): number {
  const now = Date.now()
  const run = activeRun
  if (run && run.id === null) {
    run.id = tx
      .insert(actionRuns)
      .values({ createdAt: now, trigger: run.trigger, label: run.label })
      .returning({ id: actionRuns.id })
      .get().id
  }
  const row = tx
    .insert(actionLog)
    .values({
      createdAt: now,
      source: entry.source,
      label: entry.label,
      changes: entry.changes,
      runId: run?.id ?? null,
      searchText: entry.changes
        .map(changeName)
        .filter((name) => name !== null)
        .join('\n')
    })
    .returning({ id: actionLog.id })
    .get()
  const txIds = [...new Set(entry.changes.filter(isTransactionChange).map((c) => c.transactionId))]
  // two variables per row
  for (const chunk of chunks(txIds, IN_CHUNK / 2)) {
    tx.insert(actionLogTransactions)
      .values(chunk.map((transactionId) => ({ entryId: row.id, transactionId })))
      .onConflictDoNothing()
      .run()
  }
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
    // amount/posted are NOT NULL columns, so target/guard are never null here
    case 'amount':
      return tx.update(transactions).set({ amount: target! }).where(where).run().changes
    case 'posted':
      return tx.update(transactions).set({ posted: target! }).where(where).run().changes
  }
}

// guarded description rewrite — the one string-valued transaction field, so it
// bypasses the numeric currentValueIs machinery (same shape as a conversation title)
function setDescriptionGuarded(
  tx: Tx,
  change: Extract<TransactionActionChange, { field: 'description' }>,
  direction: 'undo' | 'redo'
): number {
  const target = direction === 'undo' ? change.before : change.after
  const guard = direction === 'undo' ? change.after : change.before
  return tx
    .update(transactions)
    .set({ description: target })
    .where(and(eq(transactions.id, change.transactionId), eq(transactions.description, guard)))
    .run().changes
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

// same guarded semantics for a saved filter's soft-delete timestamp, plus one
// extra guard the other setters don't need: the name index is unique among live
// presets, so restoring into a name the user has since re-saved would violate
// it. That counts as superseded — skip it rather than fail the whole undo.
function setSavedFilterGuarded(
  tx: Tx,
  change: SavedFilterActionChange,
  direction: 'undo' | 'redo'
): number {
  const target = direction === 'undo' ? change.before : change.after
  const guard = direction === 'undo' ? change.after : change.before
  if (target === null) {
    const live = tx
      .select({ id: savedFilters.id })
      .from(savedFilters)
      .where(and(eq(savedFilters.name, change.name), isNull(savedFilters.deletedAt)))
      .get()
    if (live) return 0
  }
  const where = and(
    eq(savedFilters.id, change.savedFilterId),
    guard === null ? isNull(savedFilters.deletedAt) : sql`${savedFilters.deletedAt} = ${guard}`
  )
  return tx.update(savedFilters).set({ deletedAt: target }).where(where).run().changes
}

// same guarded semantics; goal names carry no unique index, so unlike saved
// filters there's nothing to collide with on the way back
function setGoalGuarded(
  tx: Tx,
  change: SavingsGoalActionChange,
  direction: 'undo' | 'redo'
): number {
  const byId = eq(savingsGoals.id, change.goalId)
  const nullable = (col: SQLiteColumn, guard: string | number | null): SQL =>
    guard === null ? isNull(col) : sql`${col} = ${guard}`
  switch (change.field) {
    case 'savingsGoalDeletedAt': {
      const [target, guard] = sides(change, direction)
      return tx
        .update(savingsGoals)
        .set({ deletedAt: target })
        .where(and(byId, nullable(savingsGoals.deletedAt, guard)))
        .run().changes
    }
    case 'savingsGoalTargetAmount': {
      const [target, guard] = sides(change, direction)
      return tx
        .update(savingsGoals)
        .set({ targetAmount: target })
        .where(and(byId, eq(savingsGoals.targetAmount, guard)))
        .run().changes
    }
    case 'savingsGoalTargetDate': {
      const [target, guard] = sides(change, direction)
      return tx
        .update(savingsGoals)
        .set({ targetDate: target })
        .where(and(byId, nullable(savingsGoals.targetDate, guard)))
        .run().changes
    }
    case 'savingsGoalArchivedAt': {
      const [target, guard] = sides(change, direction)
      return tx
        .update(savingsGoals)
        .set({ archivedAt: target })
        .where(and(byId, nullable(savingsGoals.archivedAt, guard)))
        .run().changes
    }
  }
}

/** [target, guard]: undo writes before over after, redo the reverse */
export function sides<T>(change: { before: T; after: T }, direction: 'undo' | 'redo'): [T, T] {
  return direction === 'undo' ? [change.before, change.after] : [change.after, change.before]
}

// undo rewinds each field to `before` (guarding on `after`); redo does the
// reverse. Either way the guard makes it a no-op on rows touched since, so an
// old entry can never clobber newer edits. Returns rows actually changed.
function applyEntry(entryId: number, direction: 'undo' | 'redo', runner: Runner = db): UndoResult {
  return runner.transaction((tx) => {
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
      } else if (change.field === 'savedFilterDeletedAt') {
        applied += setSavedFilterGuarded(tx, change, direction)
      } else if (isSavingsGoalChange(change)) {
        applied += setGoalGuarded(tx, change, direction)
      } else if (change.field === 'description') {
        applied += setDescriptionGuarded(tx, change, direction)
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

/** Undo one entry by id, as the Activity page and toast Undo do. */
export function undoAction(entryId: number, runner: Runner = db): UndoResult {
  return applyEntry(entryId, 'undo', runner)
}

// a run's entries in one transaction: undo the applied ones newest first, redo
// the undone ones oldest first, so each lands on the state it was recorded over
function applyRun(runId: number, direction: 'undo' | 'redo'): RunUndoResult {
  return db.transaction((tx) => {
    const ids = tx
      .select({ id: actionLog.id })
      .from(actionLog)
      .where(
        and(
          eq(actionLog.runId, runId),
          direction === 'undo' ? isNull(actionLog.undoneAt) : isNotNull(actionLog.undoneAt)
        )
      )
      .orderBy(direction === 'undo' ? desc(actionLog.id) : asc(actionLog.id))
      .all()
    let applied = 0
    for (const { id } of ids) applied += applyEntry(id, direction, tx).applied
    return { runId, entries: ids.length, applied }
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

// each change joined to its current context: a transaction change to its
// transaction (null when later removed, e.g. on disconnect), a budget change to
// its category name
function enrichChanges(changes: ActionChange[]): ActionLogChange[] {
  const txIds = [...new Set(changes.filter(isTransactionChange).map((c) => c.transactionId))]
  const context = chunks(txIds).flatMap((ids) =>
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        accountName: accounts.name,
        amount: transactions.amount,
        currency: accounts.currency,
        date: transactions.effectiveDate
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(inArray(transactions.id, ids))
      .all()
  )
  const byId = new Map(context.map((c) => [c.id, c]))

  const budgetCatIds = [
    ...new Set(
      changes
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
  let fallbackCurrency: string | undefined

  return changes.map((change) => {
    if (change.field === 'budgetAmount') {
      return { ...change, categoryName: catById.get(change.categoryId) ?? null, currency }
    }
    if (change.field === 'savingsGoalTargetAmount') {
      return {
        ...change,
        currency: change.currency ?? (fallbackCurrency ??= dominantCurrency())
      }
    }
    // these carry their own display context (title/name), so nothing to join
    if (
      change.field === 'conversationTitle' ||
      change.field === 'conversationDeletedAt' ||
      change.field === 'savedFilterDeletedAt' ||
      isSavingsGoalChange(change)
    ) {
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
}

function domainOf(change: ActionChange): ActionDomain {
  if (change.field === 'budgetAmount') return 'budgets'
  if (change.field === 'conversationTitle' || change.field === 'conversationDeletedAt')
    return 'conversations'
  if (change.field === 'savedFilterDeletedAt') return 'savedFilters'
  if (isSavingsGoalChange(change)) return 'goals'
  return 'transactions'
}

// the one category every change sends its row to, when there is exactly one
function sharedCategoryId(changes: ActionChange[]): number | null {
  const targets = new Set(changes.map((c) => (c.field === 'categoryId' ? c.after : undefined)))
  const [target] = targets
  return targets.size === 1 && typeof target === 'number' ? target : null
}

// an entry's summary plus only the changes the Activity row previews; the rest
// load on demand through entryChanges
function enrich(rows: (typeof actionLog.$inferSelect)[]): ActionLogEntry[] {
  const previews = rows.map((r) => r.changes.slice(0, ACTION_LOG_PREVIEW_CHANGES))
  const enriched = enrichChanges(previews.flat())
  let at = 0
  return rows.map((row, i) => ({
    id: row.id,
    createdAt: row.createdAt,
    source: row.source as ActionSource,
    label: row.label,
    undoneAt: row.undoneAt,
    runId: row.runId,
    changeCount: row.changes.length,
    sharedCategoryId: sharedCategoryId(row.changes),
    domains: [...new Set(row.changes.map(domainOf))],
    changes: enriched.slice(at, (at += previews[i].length))
  }))
}

function entryChanges(id: number): ActionLogChange[] {
  const row = db
    .select({ changes: actionLog.changes })
    .from(actionLog)
    .where(eq(actionLog.id, id))
    .get()
  return row ? enrichChanges(row.changes) : []
}

// search covers the label, the names and titles changes carry with them
// (search_text), and the current description of every transaction an entry
// touched (action_log_transactions)
function searchWhere(q: string): SQL {
  const term = '%' + escapeLike(q) + '%'
  return sql`(${actionLog.label} like ${term} escape '\\'
    or ${actionLog.searchText} like ${term} escape '\\'
    or ${actionLog.id} in (
      select ${actionLogTransactions.entryId} from ${actionLogTransactions}
      where ${actionLogTransactions.transactionId} in (
        select ${transactions.id} from ${transactions}
        where ${transactions.description} like ${term} escape '\\'
      )
    ))`
}

function listPage({ before, source, q }: ActionLogPageInput): ActionLogPage {
  const filtered = source !== undefined || !!q
  const where = and(
    before !== undefined ? lt(actionLog.id, before) : undefined,
    source ? eq(actionLog.source, source) : undefined,
    q ? searchWhere(q) : undefined
  )
  const rows = db
    .select()
    .from(actionLog)
    .where(where)
    .orderBy(desc(actionLog.id))
    .limit(PAGE_SIZE + 1)
    .all()
  let hasMore = rows.length > PAGE_SIZE
  rows.length = Math.min(rows.length, PAGE_SIZE)

  // an unfiltered page shows runs as cards, so finish the last one here rather
  // than splitting it across a Load older
  const last = rows.at(-1)
  if (!filtered && hasMore && last?.runId != null) {
    rows.push(
      ...db
        .select()
        .from(actionLog)
        .where(and(eq(actionLog.runId, last.runId), lt(actionLog.id, last.id)))
        .orderBy(desc(actionLog.id))
        .all()
    )
    hasMore = !!db
      .select({ id: actionLog.id })
      .from(actionLog)
      .where(lt(actionLog.id, rows.at(-1)!.id))
      .limit(1)
      .get()
  }

  const runIds = [...new Set(rows.map((r) => r.runId).filter((id): id is number => id !== null))]
  const runs: Record<number, ActionRun> = {}
  if (runIds.length) {
    for (const run of db.select().from(actionRuns).where(inArray(actionRuns.id, runIds)).all()) {
      runs[run.id] = run
    }
  }
  return { entries: enrich(rows), runs, nextBefore: hasMore ? rows.at(-1)!.id : null }
}

// what the Activity nav dot compares against: the app's own changes, never the
// user's edits or the imports they started
function newestAutomatedAt(): number | null {
  const row = db
    .select({ createdAt: actionLog.createdAt })
    .from(actionLog)
    .where(and(ne(actionLog.source, 'user'), ne(actionLog.source, 'import')))
    .orderBy(desc(actionLog.id))
    .limit(1)
    .get()
  return row?.createdAt ?? null
}

// compact the log at startup: drop entries that have sat undone longer than the
// retention window. Applied history stays intact — only abandoned undos go.
export function purgeStaleUndoneEntries(): void {
  const cutoff = Date.now() - UNDONE_RETENTION_MS
  const removed = db
    .delete(actionLog)
    .where(and(isNotNull(actionLog.undoneAt), lt(actionLog.undoneAt, cutoff)))
    .run().changes
  // and the runs that leaves with no entries
  db.delete(actionRuns)
    .where(sql`not exists (select 1 from ${actionLog} where ${actionLog.runId} = ${actionRuns.id})`)
    .run()
  if (removed > 0) log.info('action-log.purged-stale-undone', { count: removed })
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

  ipcMain.handle(ACTION_LOG_IPC.page, (_event, input: unknown) =>
    listPage(actionLogPageSchema.parse(input ?? {}))
  )
  ipcMain.handle(ACTION_LOG_IPC.entryChanges, (_event, input: unknown) =>
    entryChanges(idSchema.parse(input))
  )
  ipcMain.handle(ACTION_LOG_IPC.newestAutomatedAt, () => newestAutomatedAt())
  ipcMain.handle(ACTION_LOG_IPC.undo, () => undoNewest())
  ipcMain.handle(ACTION_LOG_IPC.redo, () => redoNewest())
  ipcMain.handle(ACTION_LOG_IPC.undoEntry, (_event, input: unknown) =>
    applyEntry(idSchema.parse(input), 'undo')
  )
  ipcMain.handle(ACTION_LOG_IPC.redoEntry, (_event, input: unknown) =>
    applyEntry(idSchema.parse(input), 'redo')
  )
  ipcMain.handle(ACTION_LOG_IPC.undoRun, (_event, input: unknown) =>
    applyRun(idSchema.parse(input), 'undo')
  )
  ipcMain.handle(ACTION_LOG_IPC.redoRun, (_event, input: unknown) =>
    applyRun(idSchema.parse(input), 'redo')
  )
}
