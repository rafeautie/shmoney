import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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
  return db
}
