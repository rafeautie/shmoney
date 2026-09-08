// Pure pace math, free of db imports so vitest can load it (the split
// budgets/rollover.ts uses).
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarMonths,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear
} from 'date-fns'
import { bucketLabelFor, MAX_BUCKETS, type TimeGrain } from '@shared/reports'
import type { GoalPace, GoalStatus } from '@shared/goals'

export interface PaceInput {
  targetAmount: number
  baselineAmount: number
  progress: number
  /** unix seconds */
  startedAt: number
  /** 'YYYY-MM-DD' local day, or null for an undated goal */
  targetDate: string | null
  /** unix seconds */
  now: number
}

/** `new Date(string)` would read a bare 'YYYY-MM-DD' as UTC. */
export function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function computePace(input: PaceInput): GoalPace {
  const { targetAmount, baselineAmount, progress, startedAt, targetDate, now } = input
  const remaining = Math.max(0, targetAmount - progress)
  const nowDate = new Date(now * 1000)

  // calendar months, so a monthly figure lines up with the user's month
  const monthsElapsed = Math.max(1, differenceInCalendarMonths(nowDate, new Date(startedAt * 1000)))
  const averagePerMonth = (progress - baselineAmount) / monthsElapsed

  if (targetDate === null) {
    return {
      remaining,
      status: progress >= targetAmount ? 'reached' : 'no-date',
      expectedByNow: null,
      neededPerMonth: null,
      averagePerMonth,
      projectedDate: projectDate(nowDate, remaining, averagePerMonth, progress >= targetAmount)
    }
  }

  // the goal has all of the target day, so overdue starts once the day ends
  const deadline = endOfDay(parseLocalDay(targetDate))
  const deadlineSec = Math.floor(deadline.getTime() / 1000)
  const span = deadlineSec - startedAt
  const fraction = span > 0 ? Math.min(1, Math.max(0, (now - startedAt) / span)) : 1
  const expectedByNow = baselineAmount + (targetAmount - baselineAmount) * fraction

  const status: GoalStatus =
    progress >= targetAmount
      ? 'reached'
      : now > deadlineSec
        ? 'overdue'
        : progress < expectedByNow
          ? 'behind'
          : 'on-track'

  const monthsRemaining = Math.max(1, differenceInCalendarMonths(deadline, nowDate))
  return {
    remaining,
    status,
    expectedByNow,
    neededPerMonth:
      status === 'reached' || status === 'overdue' ? null : remaining / monthsRemaining,
    averagePerMonth,
    projectedDate: projectDate(nowDate, remaining, averagePerMonth, status === 'reached')
  }
}

function projectDate(
  now: Date,
  remaining: number,
  averagePerMonth: number,
  reached: boolean
): string | null {
  if (reached || averagePerMonth <= 0) return null
  const months = remaining / averagePerMonth
  if (!Number.isFinite(months)) return null
  return format(addMonths(now, Math.ceil(months)), 'yyyy-MM-dd')
}

export interface SeriesBucket {
  label: string
  /** unix seconds of the bucket's last instant */
  endSec: number
}

export type SeriesGrain = Exclude<TimeGrain, 'none'>

export const STEPPERS: Record<
  SeriesGrain,
  { start: (d: Date) => Date; end: (d: Date) => Date; add: (d: Date, n: number) => Date }
> = {
  day: { start: startOfDay, end: endOfDay, add: addDays },
  week: {
    start: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
    end: (d: Date) => endOfWeek(d, { weekStartsOn: 1 }),
    add: addWeeks
  },
  month: { start: startOfMonth, end: endOfMonth, add: addMonths },
  quarter: { start: startOfQuarter, end: endOfQuarter, add: addQuarters },
  year: { start: startOfYear, end: endOfYear, add: addYears }
}

/**
 * Buckets from `startSec` up to now, ascending. Labels match bucketLabelFor,
 * which is what bucketSql emits, so flows join back by label.
 *
 * Walked backwards from now, because the cap has to drop the OLDEST buckets:
 * back-projection reports savedNow at the newest one, so truncating that end
 * would date the goal's current balance years in the past.
 */
export function bucketsUpToNow(
  grain: SeriesGrain,
  startSec: number,
  now: Date = new Date()
): SeriesBucket[] {
  const step = STEPPERS[grain]
  const from = step.start(new Date(startSec * 1000)).getTime()
  const buckets: SeriesBucket[] = []
  let cursor = step.start(now)
  while (cursor.getTime() >= from && buckets.length < MAX_BUCKETS) {
    buckets.push({
      label: bucketLabelFor(grain, cursor),
      endSec: Math.floor(step.end(cursor).getTime() / 1000)
    })
    cursor = step.add(cursor, -1)
  }
  return buckets.reverse()
}

/**
 * saved(b) = savedNow − (flows after b), which makes the last point equal the
 * goal's headline. `floorSec` drops buckets from before a contributions goal
 * existed; null in balance mode, where earlier balances are real history.
 */
export function backProjectSeries(
  savedNow: number,
  buckets: SeriesBucket[],
  flowAfter: Map<string, number>,
  floorSec: number | null
): { label: string; saved: number }[] {
  return buckets
    .filter((bucket) => floorSec === null || bucket.endSec > floorSec)
    .map((bucket) => ({
      label: bucket.label,
      saved: savedNow - (flowAfter.get(bucket.label) ?? 0)
    }))
}

/** Per-bucket flows as running totals of everything after each bucket. Ascending order. */
export function suffixFlows(
  buckets: SeriesBucket[],
  flowIn: Map<string, number>
): Map<string, number> {
  const after = new Map<string, number>()
  let running = 0
  for (let i = buckets.length - 1; i >= 0; i--) {
    after.set(buckets[i].label, running)
    running += flowIn.get(buckets[i].label) ?? 0
  }
  return after
}
