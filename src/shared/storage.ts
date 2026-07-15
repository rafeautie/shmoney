// on-disk size of the SQLite database, for the Storage settings card
export interface DatabaseSize {
  // main file plus the -wal/-shm companions WAL mode creates
  totalBytes: number
  // per-table bytes (each table's btree plus its indexes), largest first
  tables: { name: string; bytes: number }[]
}

export const STORAGE_IPC = {
  getDatabaseSize: 'storage:getDatabaseSize'
} as const
