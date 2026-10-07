import fs from 'node:fs'
import path from 'node:path'
import { parseSnapshotName } from './snapshots'

// A restore can't swap the database file under the open connection, so it is
// requested by marker and carried out on the next launch, before anything
// opens the database. Electron-free so db/index.ts can run it at import time.

export const backupsDir = (userData: string): string => path.join(userData, 'backups')

const markerPath = (userData: string): string => path.join(userData, 'restore-pending.json')

export function requestRestore(userData: string, name: string): void {
  fs.writeFileSync(markerPath(userData), JSON.stringify({ name }))
}

/** returns the restored snapshot's name, or null when no restore was pending */
export function applyPendingRestore(userData: string, dbPath: string): string | null {
  const marker = markerPath(userData)
  if (!fs.existsSync(marker)) return null
  const { name } = JSON.parse(fs.readFileSync(marker, 'utf8')) as { name: unknown }
  const source =
    typeof name === 'string' && parseSnapshotName(name)
      ? path.join(backupsDir(userData), name)
      : null
  if (!source || !fs.existsSync(source)) {
    fs.rmSync(marker)
    return null
  }

  const staged = `${dbPath}.restoring`
  fs.copyFileSync(source, staged)
  // the old write-ahead log must go before the new file lands, or SQLite would
  // replay its frames onto the restored pages. Its contents are safe in the
  // pre-restore snapshot taken before the relaunch
  fs.rmSync(`${dbPath}-wal`, { force: true })
  fs.rmSync(`${dbPath}-shm`, { force: true })
  fs.renameSync(staged, dbPath)
  // last, so a crash partway through retries the whole swap next launch
  fs.rmSync(marker)
  return name as string
}
