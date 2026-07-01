import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { is } from '@electron-toolkit/utils'
import * as schema from './schema'

const dbPath = path.join(app.getPath('userData'), 'shmoney.db')

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

export function runMigrations(): void {
  const migrationsFolder = is.dev
    ? path.join(__dirname, '../../drizzle')
    : path.join(process.resourcesPath, 'drizzle')

  if (!fs.existsSync(migrationsFolder)) {
    console.warn(`[db] No migrations folder found at ${migrationsFolder}, skipping migrate()`)
    return
  }

  migrate(db, { migrationsFolder })
}
