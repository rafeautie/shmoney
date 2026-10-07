import { BACKUP_KINDS, type Backup, type BackupKind } from '@shared/storage'

// Snapshot naming and retention, kept free of electron and the live database
// so they can be unit-tested.

export const DAILY_KEEP = 7
export const WEEKLY_KEEP = 4
const KEEP_BY_KIND: Partial<Record<BackupKind, number>> = { manual: 10, 'pre-restore': 3 }

const NAME_RE = new RegExp(
  `^shmoney-(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})(\\d{2})(\\d{2})(\\d{3})-(${BACKUP_KINDS.join('|')})\\.db$`
)

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** local time, so the names sort by age and read like the dates the UI shows */
export function snapshotName(kind: BackupKind, at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}${pad(at.getMilliseconds(), 3)}`
  return `shmoney-${date}-${time}-${kind}.db`
}

export function parseSnapshotName(name: string): { kind: BackupKind; createdAt: number } | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s, ms] = m.slice(1, 8).map(Number)
  return { kind: m[8] as BackupKind, createdAt: new Date(y, mo - 1, d, h, mi, s, ms).getTime() }
}

const isAutomatic = (kind: BackupKind): boolean => kind === 'daily' || kind === 'pre-migration'

const dayKey = (ms: number): string => new Date(ms).toDateString()

function weekKey(ms: number): string {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toDateString()
}

/** whether today has no automatic snapshot yet */
export function dailyDue(backups: Pick<Backup, 'kind' | 'createdAt'>[], now: number): boolean {
  const today = dayKey(now)
  return !backups.some((b) => isAutomatic(b.kind) && dayKey(b.createdAt) === today)
}

/**
 * The snapshots retention drops. Automatic ones keep the newest of each of the
 * last 7 days that have one, plus the newest of each of the last 4 weeks;
 * manual and pre-restore snapshots keep the newest few of their kind.
 */
export function planPrune(backups: Pick<Backup, 'name' | 'kind' | 'createdAt'>[]): string[] {
  const newest = [...backups].sort((a, b) => b.createdAt - a.createdAt)
  const keep = new Set<string>()

  const days = new Set<string>()
  const weeks = new Set<string>()
  for (const b of newest.filter((b) => isAutomatic(b.kind))) {
    const day = dayKey(b.createdAt)
    if (days.size < DAILY_KEEP && !days.has(day)) {
      days.add(day)
      keep.add(b.name)
    }
    const week = weekKey(b.createdAt)
    if (weeks.size < WEEKLY_KEEP && !weeks.has(week)) {
      weeks.add(week)
      keep.add(b.name)
    }
  }
  for (const [kind, limit] of Object.entries(KEEP_BY_KIND)) {
    for (const b of newest.filter((b) => b.kind === kind).slice(0, limit)) keep.add(b.name)
  }

  return newest.filter((b) => !keep.has(b.name)).map((b) => b.name)
}
