import fs from 'node:fs'
import initSqlJs from 'sql.js'
import { databaseFile } from '../../../demo/db'

// main/db/index.ts for the specs: the demo's in-memory database, plus the file
// operations backups and export need, done with sql.js against real files
export * from '../../../demo/db'

const SQL = await initSqlJs()

export async function backupDatabase(dest: string): Promise<void> {
  fs.writeFileSync(dest, databaseFile())
}

export const hasPendingMigrations = (): boolean => false

export function isRestorableDatabase(file: string): boolean {
  try {
    const candidate = new SQL.Database(fs.readFileSync(file))
    try {
      const [check] = candidate.exec('PRAGMA quick_check')
      const [tables] = candidate.exec(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'"
      )
      return check?.values[0]?.[0] === 'ok' && tables !== undefined
    } finally {
      candidate.close()
    }
  } catch {
    return false
  }
}
