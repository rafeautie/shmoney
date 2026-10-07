// The chat tools' read-only connection to the app database and the scope
// views they query through.
import Database from 'better-sqlite3'
import type { QueryToolResult } from '@shared/chat'
import { registerStatFunctions } from '../stat-functions'
import { merchantOf } from '@shared/merchant'
import {
  GOAL_HISTORY_INSERT_SQL,
  GOAL_INSERT_SQL,
  goalTableDdl,
  MAX_ROWS,
  scopeViewsDdl,
  shapeResult,
  validateQuerySql,
  type ChatToolScope,
  type GoalTableRows
} from '../tools/sql-tool'

const dbPath: string = (() => {
  const p = process.env.SHMONEY_DB_PATH
  if (!p) throw new Error('SHMONEY_DB_PATH is not set')
  return p
})()

// the chat query tool's own connection to the app database, opened lazily on
// the first chat turn. It reads the same WAL file main writes; writes are
// blocked by PRAGMA query_only except inside refreshScopeViews' DDL window.
let toolDb: Database.Database | null = null

export function ensureToolDb(): Database.Database {
  if (toolDb) return toolDb
  const db = new Database(dbPath, { fileMustExist: true })
  // extra aggregates (MEDIAN/PERCENTILE/STDDEV) the model queries through; the
  // cast is because @types/better-sqlite3 types only a single-argument step and
  // cannot describe PERCENTILE's two args (see stat-functions.ts)
  registerStatFunctions((name, def) =>
    db.aggregate(name, def as unknown as Database.AggregateOptions)
  )
  // the tx view's merchant column calls it, so it must exist before any view does
  db.function('MERCHANT', { deterministic: true }, merchantOf)
  db.pragma('query_only = ON')
  toolDb = db
  return db
}

export function closeToolDb(): void {
  toolDb?.close()
  toolDb = null
}

/**
 * (Re)build the temp views the model queries through, narrowed to the turn's
 * scope, and refill the goal tables from the rows main sent. query_only lifts
 * only around our own DDL; a failure here must fail the turn (never prompt
 * against a stale scope), so no try/catch beyond restoring the pragma.
 */
export function refreshScopeViews(scope: ChatToolScope, goalRows: GoalTableRows): void {
  const db = ensureToolDb()
  db.pragma('query_only = OFF')
  try {
    for (const ddl of scopeViewsDdl(scope)) db.exec(ddl)
    for (const ddl of goalTableDdl()) db.exec(ddl)
    const goal = db.prepare(GOAL_INSERT_SQL)
    for (const row of goalRows.goals) goal.run(...(row as Parameters<typeof goal.run>))
    const history = db.prepare(GOAL_HISTORY_INSERT_SQL)
    for (const row of goalRows.history) history.run(...(row as Parameters<typeof history.run>))
  } finally {
    db.pragma('query_only = ON')
  }
}

/**
 * Execute one model-supplied query. Never throws: a thrown error would abort
 * the whole generation, so every failure becomes an { ok: false } result the
 * model can read and correct.
 */
export function runQuery(sql: string): QueryToolResult {
  const started = Date.now()
  const fail = (error: string): QueryToolResult => ({
    ok: false,
    error,
    durationMs: Date.now() - started
  })
  const valid = validateQuerySql(sql)
  if (!valid.ok) return fail(valid.error)
  try {
    // prepare() also rejects multi-statement strings, and stmt.readonly
    // catches writes the keyword check can't see (e.g. CTE-wrapped mutations)
    const stmt = ensureToolDb().prepare(sql)
    if (!stmt.readonly || !stmt.reader) return fail('Only read-only SELECT queries are allowed.')
    stmt.raw(true)
    const rows: unknown[][] = []
    // pull at most one row past the cap: enough for shapeResult to see the
    // truncation, without streaming an unbounded result through memory
    for (const row of stmt.iterate()) {
      rows.push(row as unknown[])
      if (rows.length > MAX_ROWS) break
    }
    const columns = stmt.columns().map((c) => c.name)
    return shapeResult(columns, rows, Date.now() - started)
  } catch (err) {
    return fail(String((err as Error)?.message ?? err))
  }
}
