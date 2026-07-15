import fs from 'node:fs'
import { ipcMain } from 'electron'
import { sql } from 'drizzle-orm'
import { db, dbPath } from '../db'
import { STORAGE_IPC, type DatabaseSize } from '@shared/storage'

export function registerStorageIpc(): void {
  ipcMain.handle(STORAGE_IPC.getDatabaseSize, (): DatabaseSize => {
    // WAL mode: the on-disk database is the main file plus its companions
    let totalBytes = 0
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        totalBytes += fs.statSync(dbPath + suffix).size
      } catch {
        // companion files come and go with checkpoints
      }
    }

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

    return { totalBytes, tables }
  })
}
