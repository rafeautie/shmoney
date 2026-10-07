// on-disk size of the SQLite database, for the Storage settings card
export interface DatabaseSize {
  // main file plus the -wal/-shm companions WAL mode creates
  totalBytes: number
  // per-table bytes (each table's btree plus its indexes), largest first
  tables: { name: string; bytes: number }[]
}

// daily and pre-migration snapshots are automatic and pruned on a schedule;
// manual and pre-restore ones are kept until newer ones of their kind push them out
export const BACKUP_KINDS = ['daily', 'pre-migration', 'manual', 'pre-restore'] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

export interface Backup {
  // the file name inside the backups folder, which is also its id
  name: string
  kind: BackupKind
  // unix ms
  createdAt: number
  bytes: number
}

// where a full export landed; null when the folder picker was cancelled
export type ExportResult = { path: string } | null

export const STORAGE_IPC = {
  getDatabaseSize: 'storage:getDatabaseSize',
  listBackups: 'storage:listBackups',
  backupNow: 'storage:backupNow',
  restoreBackup: 'storage:restoreBackup',
  showBackupsFolder: 'storage:showBackupsFolder',
  exportAll: 'storage:exportAll',
  showInFolder: 'storage:showInFolder'
} as const
