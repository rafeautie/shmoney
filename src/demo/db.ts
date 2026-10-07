import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from '../main/db/schema'
import journal from '../../drizzle/meta/_journal.json'
import { merchantOf } from '../shared/merchant'

// Stands in for main/db/index.ts: the same drizzle schema over an in-memory
// SQLite compiled to WebAssembly. drizzle's sql-js driver is synchronous like
// better-sqlite3, so every main-process query runs unchanged.

// under Node (vitest) sql.js loads its own wasm from beside itself
const SQL = await initSqlJs(typeof document === 'undefined' ? {} : { locateFile: () => wasmUrl })
const sqlite = new SQL.Database()
sqlite.run('PRAGMA foreign_keys = ON')
// better-sqlite3's run() reports { changes }, which undo counts and several
// handlers read; sql.js returns nothing, so report it the same way
const prepare = sqlite.prepare.bind(sqlite)
sqlite.prepare = (source, params) => {
  const stmt = prepare(source, params)
  const run = stmt.run.bind(stmt)
  stmt.run = ((values) => {
    run(values)
    return { changes: sqlite.getRowsModified() }
  }) as typeof stmt.run
  return stmt
}
// the chat scope views' merchant column calls it (seeded demo transcripts run them)
sqlite.create_function('MERCHANT', merchantOf)

export const db = drizzle(sqlite, { schema })

export const dbPath = ':memory:'

const migrationFiles = import.meta.glob<string>('../../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true
})

// the parts of drizzle's migrator that don't touch the filesystem
interface Migrator {
  dialect: { migrate(migrations: unknown[], session: unknown, config: object): void }
  session: unknown
}

export function runMigrations(): void {
  const migrations = journal.entries.map((entry) => {
    const query = migrationFiles[`../../drizzle/${entry.tag}.sql`]
    if (query === undefined) throw new Error(`Missing migration ${entry.tag}`)
    return {
      sql: query.split('--> statement-breakpoint'),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: entry.tag
    }
  })
  // same bracket as the desktop app: recreate-table migrations must not
  // cascade deletes while they copy rows across
  sqlite.run('PRAGMA foreign_keys = OFF')
  try {
    const { dialect, session } = db as unknown as Migrator
    dialect.migrate(migrations, session, {})
  } finally {
    sqlite.run('PRAGMA foreign_keys = ON')
  }
}

/** page_count * page_size: the file size this database would have on disk */
export function databaseBytes(): number {
  const [result] = sqlite.exec(
    'SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()'
  )
  return Number(result?.values[0]?.[0] ?? 0)
}

/**
 * The database as file bytes. export() reopens the connection, which drops the
 * per-connection state set up above, so that is restored after.
 */
export function databaseFile(): Uint8Array {
  const bytes = sqlite.export()
  sqlite.run('PRAGMA foreign_keys = ON')
  sqlite.create_function('MERCHANT', merchantOf)
  return bytes
}

// the demo's export overrides never write files; the test harness supplies its own
export async function backupDatabase(): Promise<void> {
  throw new Error('The web demo keeps its data in memory')
}
