import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { is } from '@electron-toolkit/utils'
import { createLogger } from '../logging'
import * as schema from './schema'
import { merchantOf } from '../llm/tools/analysis/merchant'
import { applyPendingRestore } from '../backups/restore'

const log = createLogger('db')

export const dbPath = path.join(app.getPath('userData'), 'shmoney.db')

const restored = applyPendingRestore(app.getPath('userData'), dbPath)
if (restored) log.info('backup.restored', { name: restored })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
// the chat scope views' merchant column calls it (demo transcripts run them here)
sqlite.function('MERCHANT', { deterministic: true }, merchantOf)

export const db = drizzle(sqlite, { schema })

const migrationsFolder = is.dev
  ? path.join(__dirname, '../../drizzle')
  : path.join(process.resourcesPath, 'drizzle')

/** a consistent copy of the live database, WAL included, written to `dest` */
export async function backupDatabase(dest: string): Promise<void> {
  await sqlite.backup(dest)
  // the copy inherits WAL mode, which would leave -wal/-shm files beside it
  // whenever it is opened; a backup is a single self-contained file
  const copy = new Database(dest)
  try {
    copy.pragma('journal_mode = DELETE')
  } finally {
    copy.close()
  }
}

/** whether `file` is an intact shmoney database, before restoring onto it */
export function isRestorableDatabase(file: string): boolean {
  try {
    const candidate = new Database(file, { readonly: true, fileMustExist: true })
    try {
      return (
        candidate.pragma('quick_check', { simple: true }) === 'ok' &&
        candidate
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
          .get() !== undefined
      )
    } finally {
      candidate.close()
    }
  } catch {
    return false
  }
}

/** whether runMigrations would change an existing database */
export function hasPendingMigrations(): boolean {
  const journal = path.join(migrationsFolder, 'meta/_journal.json')
  const tracked = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!tracked || !fs.existsSync(journal)) return false
  const { last } = sqlite
    .prepare('SELECT max(created_at) AS last FROM __drizzle_migrations')
    .get() as { last: number | null }
  const { entries } = JSON.parse(fs.readFileSync(journal, 'utf8')) as {
    entries: { when: number }[]
  }
  return entries.some((entry) => entry.when > (last ?? 0))
}

export function runMigrations(): void {
  if (!fs.existsSync(migrationsFolder)) {
    log.warn('migrations.folder-missing', { folder: migrationsFolder })
    return
  }

  // drizzle runs all migrations inside one transaction, where the PRAGMA
  // foreign_keys statements its recreate-table migrations emit are no-ops.
  // With FKs enforced, DROP TABLE implicit-deletes rows and fires ON DELETE
  // actions on child tables (e.g. wiping transactions.category_id), so
  // disable them at the connection level for the duration of the migration.
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
  log.info('migrations.complete')
}
