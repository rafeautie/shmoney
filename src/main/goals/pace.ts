// Pure savings-goal pace math, kept free of db imports so vitest can load it
// (better-sqlite3 is built for Electron's ABI and won't load under vitest).
// The same split as budgets/rollover.ts.
//
// This is the only implementation of a goal's pace in the app. Every surface
// that shows "on track" or "save X a month" reads these outputs rather than
// deriving its own, which is why they cross IPC on GoalSummary.
import { addMonths, differenceInCalendarMonths, endOfDay, format } from 'date-fns'
import type { GoalPace, GoalStatus } from '@shared/goals'

export interface PaceInput {
  /** milliunits, > 0 */
  targetAmount: number
  /** milliunits; where the pace line starts. Pace only, never progress. */
  baselineAmount: number
  /** milliunits saved so far */
  progress: number
  /** unix seconds */
  startedAt: number
  /** 'YYYY-MM-DD' local day, or null for an undated goal */
  targetDate: string | null
  /** unix seconds */
  now: number
}

/** Parse 'YYYY-MM-DD' as a local day. `new Date(string)` would read it as UTC. */
export function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function computePace(input: PaceInput): GoalPace {
  const { targetAmount, baselineAmount, progress, startedAt, targetDate, now } = input
  const remaining = Math.max(0, targetAmount - progress)
  const nowDate = new Date(now * 1000)
  const startDate = new Date(startedAt * 1000)

  // months are calendar months, never a 30.44-day approximation: the whole
  // point of a monthly figure is that it lines up with the user's month
  const monthsElapsed = Math.max(1, differenceInCalendarMonths(nowDate, startDate))
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

  // the goal has all of the target day to be met, so "overdue" starts the
  // instant after it ends
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
    // a figure the user can act on only exists while the goal is still live
    neededPerMonth:
      status === 'reached' || status === 'overdue' ? null : remaining / monthsRemaining,
    averagePerMonth,
    projectedDate: projectDate(nowDate, remaining, averagePerMonth, status === 'reached')
  }
}

/**
 * When the current rate would get there. Null when there is no rate to project
 * from, or nothing left to project.
 */
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
  /** the bucket label the SQL layer produces for this grain */
  label: string
  /** unix seconds of the bucket's last instant */
  endSec: number
}

/**
 * Saved at the end of each bucket, back-projected from what the goal has saved
 * right now: saved(b) = savedNow − (flows after the end of b). True in both
 * modes, because saved only ever moves by transactions on the linked accounts.
 *
 * Anchoring on savedNow rather than replaying forward from the baseline is what
 * keeps one formula: savedNow is the number the goal card shows, so the last
 * point of any series is the headline by construction.
 *
 * `floorSec` drops buckets that ended before the goal existed (contributions
 * mode, where earlier buckets are not the goal's history); pass null in balance
 * mode, where the account's earlier balance is real history worth drawing.
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

/**
 * Per-bucket flows turned into "everything after this bucket", which is what
 * back-projection subtracts. Buckets must be in ascending label order.
 */
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
