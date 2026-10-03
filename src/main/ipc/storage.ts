import fs from 'node:fs'
import { ipcMain } from 'electron'
import { sql } from 'drizzle-orm'
import { db, dbPath } from '../db'
import { STORAGE_IPC, type DatabaseSize } from '@shared/storage'

type TableSizes = DatabaseSize['tables']

// dbstat walks every page of the file, so its result is kept until the files
// change; any committed write touches the WAL's (or main file's) size or
// mtime. The -shm index is left out of the key since readers touch it too
let cached: { key: string; tables: TableSizes } | null = null

function tableSizes(key: string): TableSizes {
  if (cached?.key === key) return cached.tables

  // per-table page bytes via the dbstat virtual table, folding each index
  // into its table; the schema btree and free pages are nobody's, so the
  // sum stays below totalBytes and the renderer shows the gap as "Other"
  const tables = db.all<{ name: string; bytes: number }>(sql`
    SELECT m.tbl_name AS name, SUM(s.pgsize) AS bytes
    FROM sqlite_master m JOIN dbstat s ON s.name = m.name
    WHERE m.type IN ('table', 'index')
    GROUP BY m.tbl_name
    ORDER BY bytes DESC
  `)
  cached = { key, tables }
  return tables
}

export function registerStorageIpc(): void {
  ipcMain.handle(STORAGE_IPC.getDatabaseSize, (): DatabaseSize => {
    // WAL mode: the on-disk database is the main file plus its companions
    let totalBytes = 0
    const key: string[] = []
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        const stat = fs.statSync(dbPath + suffix)
        totalBytes += stat.size
        if (suffix !== '-shm') key.push(`${stat.size}:${stat.mtimeMs}`)
      } catch {
        // companion files come and go with checkpoints
        key.push('-')
      }
    }

    return { totalBytes, tables: tableSizes(key.join('|')) }
  })
}
