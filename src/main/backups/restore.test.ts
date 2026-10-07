import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPendingRestore, backupsDir, requestRestore } from './restore'
import { snapshotName } from './snapshots'

let userData: string
let dbPath: string
const read = (file: string): string => fs.readFileSync(file, 'utf8')

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'shmoney-restore-'))
  dbPath = path.join(userData, 'shmoney.db')
  fs.writeFileSync(dbPath, 'current')
  fs.writeFileSync(`${dbPath}-wal`, 'current wal')
  fs.writeFileSync(`${dbPath}-shm`, 'current shm')
  fs.mkdirSync(backupsDir(userData))
})

afterEach(() => fs.rmSync(userData, { recursive: true, force: true }))

describe('applyPendingRestore', () => {
  it('does nothing without a pending restore', () => {
    expect(applyPendingRestore(userData, dbPath)).toBeNull()
    expect(read(dbPath)).toBe('current')
    expect(read(`${dbPath}-wal`)).toBe('current wal')
  })

  it('swaps the snapshot in and drops the old write-ahead log', () => {
    const name = snapshotName('daily', new Date(2026, 9, 5))
    fs.writeFileSync(path.join(backupsDir(userData), name), 'snapshot')
    requestRestore(userData, name)

    expect(applyPendingRestore(userData, dbPath)).toBe(name)
    expect(read(dbPath)).toBe('snapshot')
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false)
    // the snapshot stays in the list, and the next launch is a normal one
    expect(read(path.join(backupsDir(userData), name))).toBe('snapshot')
    expect(applyPendingRestore(userData, dbPath)).toBeNull()
  })

  it('leaves the database alone when the snapshot is gone or the name is not one', () => {
    for (const name of [snapshotName('manual', new Date()), '../shmoney.db']) {
      requestRestore(userData, name)
      expect(applyPendingRestore(userData, dbPath)).toBeNull()
      expect(read(dbPath)).toBe('current')
      expect(read(`${dbPath}-wal`)).toBe('current wal')
      expect(applyPendingRestore(userData, dbPath)).toBeNull()
    }
  })
})
