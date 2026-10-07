import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { backupDatabase, hasPendingMigrations, isRestorableDatabase } from '../db'
import { createLogger } from '../logging'
import type { Backup, BackupKind } from '@shared/storage'
import { dailyDue, parseSnapshotName, planPrune, snapshotName } from './snapshots'
import { backupsDir, requestRestore } from './restore'

const log = createLogger('backups')

const DAILY_CHECK_MS = 60 * 60 * 1000

export const backupsFolder = (): string => backupsDir(app.getPath('userData'))

export function listBackups(): Backup[] {
  let names: string[]
  try {
    names = fs.readdirSync(backupsFolder())
  } catch {
    return []
  }
  return names
    .flatMap((name) => {
      const parsed = parseSnapshotName(name)
      if (!parsed) return []
      const { size } = fs.statSync(path.join(backupsFolder(), name))
      return [{ name, ...parsed, bytes: size }]
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

async function snapshot(kind: BackupKind): Promise<Backup> {
  fs.mkdirSync(backupsFolder(), { recursive: true })
  const name = snapshotName(kind, new Date())
  const dest = path.join(backupsFolder(), name)
  // written aside and renamed, so a half-written copy never lists as a backup
  const partial = `${dest}.partial`
  try {
    await backupDatabase(partial)
    fs.renameSync(partial, dest)
  } finally {
    fs.rmSync(partial, { force: true })
  }
  const backups = listBackups()
  for (const stale of planPrune(backups)) fs.rmSync(path.join(backupsFolder(), stale))
  log.info('backup.created', { name })
  return backups.find((b) => b.name === name)!
}

// one at a time: a daily tick landing during Back up now must not interleave
let queue: Promise<unknown> = Promise.resolve()

export function takeBackup(kind: BackupKind): Promise<Backup> {
  const next = queue.then(() => snapshot(kind))
  queue = next.catch(() => {})
  return next
}

export async function backupBeforeMigrations(): Promise<void> {
  if (!hasPendingMigrations()) return
  try {
    await takeBackup('pre-migration')
  } catch (error) {
    log.error('backup.pre-migration-failed', error)
  }
}

async function backupIfDue(): Promise<void> {
  if (!dailyDue(listBackups(), Date.now())) return
  try {
    await takeBackup('daily')
  } catch (error) {
    log.error('backup.daily-failed', error)
  }
}

export function startDailyBackups(): void {
  void backupIfDue()
  setInterval(() => void backupIfDue(), DAILY_CHECK_MS).unref()
}

/** snapshots the current data, then relaunches into `name` (see restore.ts) */
export async function restoreBackup(name: string): Promise<void> {
  if (!listBackups().some((b) => b.name === name)) throw new Error('That backup no longer exists')
  if (!isRestorableDatabase(path.join(backupsFolder(), name))) {
    throw new Error('That backup is damaged and can’t be restored')
  }
  await takeBackup('pre-restore')
  requestRestore(app.getPath('userData'), name)
  log.info('backup.restore-requested', { name })
  app.relaunch()
  app.quit()
}
