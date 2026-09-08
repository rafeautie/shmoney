import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { GOAL_STATUS_LABELS } from '@shared/goals'
import { registerStatFunctions } from './stat-functions'
import { GOAL_HISTORY_INSERT_SQL, GOAL_INSERT_SQL, goalTableDdl } from './tools/sql-tool'

// Shared test-only harness: a real, fully migrated database in memory. Not
// imported by any shipping code. better-sqlite3 can't load under vitest
// (Electron ABI), so this uses node's own SQLite against the real migration
// files — which also means a column renamed out from under the chat scope
// views fails in a test rather than in a chat reply.

const DRIZZLE = join(__dirname, '../../../drizzle')

interface Journal {
  entries: { idx: number; tag: string }[]
}

/** an in-memory database with every drizzle migration applied, in order */
export function migratedDb(): DatabaseSync {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as Journal
  const db = new DatabaseSync(':memory:')
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(join(DRIZZLE, `${entry.tag}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim()) db.exec(statement)
  }
  // the real chat connection registers these on its tool DB (see worker.ts), so
  // the test connection mirrors it and recipes using MEDIAN and friends run
  registerStatFunctions((name, def) => db.aggregate(name, def as never))
  return db
}

/**
 * The goal the prompt's worked turn asks about, in the tables the worker fills
 * before a real turn, holding the figures the prompt quotes.
 */
export function seedGoalTables(db: DatabaseSync): void {
  for (const ddl of goalTableDdl()) db.exec(ddl)
  db.prepare(GOAL_INSERT_SQL).run(
    1,
    'Japan trip',
    'contributions',
    'Ally Savings',
    'USD',
    6000,
    3120,
    2880,
    52,
    GOAL_STATUS_LABELS.behind,
    '2027-03-31',
    '2026-01-31 23:59:59',
    720,
    260,
    null
  )
  const history = db.prepare(GOAL_HISTORY_INSERT_SQL)
  const saved = [520, 1040, 1560, 2080, 2600, 3120]
  saved.forEach((amount, i) => history.run(1, 'Japan trip', `2026-0${i + 2}`, amount))
}
