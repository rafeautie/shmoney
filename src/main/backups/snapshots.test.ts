import { describe, expect, it } from 'vitest'
import type { BackupKind } from '@shared/storage'
import { dailyDue, parseSnapshotName, planPrune, snapshotName } from './snapshots'

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()

function backup(
  kind: BackupKind,
  createdAt: number
): {
  name: string
  kind: BackupKind
  createdAt: number
} {
  return { name: snapshotName(kind, new Date(createdAt)), kind, createdAt }
}

describe('snapshot names', () => {
  it('round-trips kind and time to the millisecond', () => {
    const when = new Date(2026, 9, 6, 9, 5, 7, 42)
    const name = snapshotName('pre-migration', when)
    expect(name).toBe('shmoney-2026-10-06-090507042-pre-migration.db')
    expect(parseSnapshotName(name)).toEqual({ kind: 'pre-migration', createdAt: when.getTime() })
  })

  it('ignores files that are not snapshots', () => {
    expect(parseSnapshotName('shmoney-2026-10-06-090507042-manual.db.partial')).toBeNull()
    expect(parseSnapshotName('notes.txt')).toBeNull()
    expect(parseSnapshotName('../shmoney-2026-10-06-090507042-manual.db')).toBeNull()
  })
})

describe('daily schedule', () => {
  it('is due until an automatic snapshot exists for today', () => {
    const now = at(2026, 10, 6, 15)
    expect(dailyDue([], now)).toBe(true)
    expect(dailyDue([backup('daily', at(2026, 10, 5, 23))], now)).toBe(true)
    // a manual backup is the user's, not the schedule's
    expect(dailyDue([backup('manual', at(2026, 10, 6, 8))], now)).toBe(true)
    expect(dailyDue([backup('pre-migration', at(2026, 10, 6, 8))], now)).toBe(false)
    expect(dailyDue([backup('daily', at(2026, 10, 6, 0))], now)).toBe(false)
  })
})

describe('retention', () => {
  it('keeps 7 daily and 4 weekly automatic snapshots', () => {
    // one a day for 60 days, ending Tuesday 2026-10-06
    const daily = Array.from({ length: 60 }, (_, i) => backup('daily', at(2026, 10, 6 - i)))
    const dropped = new Set(planPrune(daily))
    const kept = daily.filter((b) => !dropped.has(b.name)).map((b) => new Date(b.createdAt))
    expect(kept.map((d) => d.toDateString())).toEqual([
      // the last 7 days
      ...Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 6 - i).toDateString()),
      // newest of each of the 4 most recent Monday-to-Sunday weeks; the two
      // newest (10-06 and 10-04) are already among the days
      new Date(2026, 8, 27).toDateString(),
      new Date(2026, 8, 20).toDateString()
    ])
  })

  it('keeps the newest of a day and drops the rest', () => {
    const morning = backup('pre-migration', at(2026, 10, 6, 8))
    const evening = backup('daily', at(2026, 10, 6, 20))
    expect(planPrune([morning, evening])).toEqual([morning.name])
  })

  it('caps manual and pre-restore snapshots by count, apart from the schedule', () => {
    const manual = Array.from({ length: 12 }, (_, i) => backup('manual', at(2026, 10, 1, i)))
    const safety = Array.from({ length: 4 }, (_, i) => backup('pre-restore', at(2026, 10, 2, i)))
    const daily = backup('daily', at(2026, 10, 3))
    expect(planPrune([...manual, ...safety, daily]).sort()).toEqual(
      [manual[0].name, manual[1].name, safety[0].name].sort()
    )
  })
})
