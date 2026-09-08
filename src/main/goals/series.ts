// Saved at the end of each time bucket, per goal, shaped as the report system's
// own QueryRow. Speaking that shape is what lets the existing chart widgets plot
// goals with no new drawing code.
//
// The numbers descend from saved.ts: savedNow is the anchor and the buckets are
// back-projected off it (see backProjectSeries), so the last point of a series
// is the same figure the goal card shows, by construction.
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear
} from 'date-fns'
import { eq, sum } from 'drizzle-orm'
import { db } from '../db'
import { savingsGoalAccounts, transactions } from '../db/schema'
import { bucketSql } from '../reports/query'
import { flowSinceWhere } from './flow'
import { backProjectSeries, suffixFlows, type SeriesBucket } from './pace'
import { goalAccounts, loadGoalRows, toGoalRef } from './summary'
import { savedNow } from './saved'
import { bucketLabelFor, MAX_BUCKETS, type QueryRow, type RunQueryResult } from '@shared/reports'
import type { GoalSeriesQuery } from '@shared/goals'

const STEPPERS = {
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
 * Buckets from `startSec` up to now, with each one's last instant. Labels match
 * bucketLabelFor exactly, which is also what bucketSql produces, so the SQL
 * flows join back onto these by label.
 */
function bucketsUpToNow(grain: keyof typeof STEPPERS, startSec: number): SeriesBucket[] {
  const step = STEPPERS[grain]
  const now = Date.now()
  const buckets: SeriesBucket[] = []
  let cursor = step.start(new Date(startSec * 1000))
  while (cursor.getTime() <= now && buckets.length < MAX_BUCKETS) {
    buckets.push({
      label: bucketLabelFor(grain, cursor),
      endSec: Math.floor(step.end(cursor).getTime() / 1000)
    })
    cursor = step.add(cursor, 1)
  }
  return buckets
}

/** goalId -> (bucket label -> net flow in that bucket) */
function flowsByBucket(
  grain: keyof typeof STEPPERS,
  sinceSec: number,
  goalIds: number[]
): Map<number, Map<string, number>> {
  const bucket = bucketSql(grain)
  const rows = db
    .select({
      goalId: savingsGoalAccounts.goalId,
      bucket,
      total: sum(transactions.amount)
    })
    .from(transactions)
    .innerJoin(savingsGoalAccounts, eq(savingsGoalAccounts.accountId, transactions.accountId))
    .where(flowSinceWhere(sinceSec, goalIds))
    .groupBy(savingsGoalAccounts.goalId, bucket)
    .all()

  const byGoal = new Map<number, Map<string, number>>()
  for (const row of rows) {
    const forGoal = byGoal.get(row.goalId) ?? new Map<string, number>()
    forGoal.set(row.bucket, Number(row.total ?? 0))
    byGoal.set(row.goalId, forGoal)
  }
  return byGoal
}

export function getGoalSeries(query: GoalSeriesQuery): RunQueryResult {
  const rows = loadGoalRows(query.goalIds).filter(
    // active goals only: archived ones are history, not a status board
    (row) => row.archivedAt === null
  )
  if (rows.length === 0) return { rows: [], currencies: [] }

  const linked = goalAccounts(rows.map((r) => r.id))
  const refs = rows.map((row) =>
    toGoalRef(
      row,
      (linked.get(row.id) ?? []).map((a) => a.id)
    )
  )
  const saved = savedNow(refs)
  const currencies = [...new Set(rows.map((r) => r.currency))].sort()

  if (query.timeGrain === 'none') {
    return {
      rows: rows.map((row) => ({
        bucket: null,
        groupId: row.id,
        groupLabel: row.name,
        currency: row.currency,
        value: saved.get(row.id) ?? 0
      })),
      currencies
    }
  }

  // enumerate from the requested start (or the earliest goal start) all the way
  // to now, not to the requested end: back-projection subtracts everything that
  // landed after a bucket, so the buckets past the window still have to be
  // walked. They're dropped from the result at the end.
  const earliestStart = Math.min(...rows.map((r) => r.startedAt))
  const fromSec = query.dateStart ?? earliestStart
  const buckets = bucketsUpToNow(query.timeGrain, fromSec)
  if (buckets.length === 0) return { rows: [], currencies }

  // one second before the first bucket begins, so that bucket's own flows are
  // in the set too and the suffix sums start from a complete picture
  const sinceSec =
    Math.floor(STEPPERS[query.timeGrain].start(new Date(fromSec * 1000)).getTime() / 1000) - 1
  const flows = flowsByBucket(
    query.timeGrain,
    sinceSec,
    rows.map((r) => r.id)
  )
  const lastLabel =
    query.dateEnd === null ? null : bucketLabelFor(query.timeGrain, new Date(query.dateEnd * 1000))

  const out: QueryRow[] = []
  for (const row of rows) {
    const after = suffixFlows(buckets, flows.get(row.id) ?? new Map())
    // contributions goals didn't exist before their start, so earlier buckets
    // are a gap rather than a zero; a balance goal's earlier balance is real
    const floorSec = row.mode === 'contributions' ? row.startedAt : null
    for (const point of backProjectSeries(saved.get(row.id) ?? 0, buckets, after, floorSec)) {
      if (lastLabel !== null && point.label > lastLabel) continue
      out.push({
        bucket: point.label,
        groupId: row.id,
        groupLabel: row.name,
        currency: row.currency,
        value: point.saved
      })
    }
  }
  return { rows: out, currencies }
}
