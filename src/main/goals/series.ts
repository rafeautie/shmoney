// Saved per goal per time bucket, in the report system's QueryRow shape so the
// existing chart widgets can plot goals with no new drawing code.
import { eq, sum } from 'drizzle-orm'
import { db } from '../db'
import { savingsGoalAccounts, transactions } from '../db/schema'
import { bucketSql } from '../reports/query'
import { flowSinceWhere } from './flow'
import { backProjectSeries, bucketsUpToNow, STEPPERS, suffixFlows, type SeriesGrain } from './pace'
import { goalAccounts, loadGoalRows, toGoalRef } from './summary'
import { savedNow } from './saved'
import { bucketLabelFor, type QueryRow, type RunQueryResult } from '@shared/reports'
import type { GoalSeriesQuery } from '@shared/goals'

function flowsByBucket(
  grain: SeriesGrain,
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
  const rows = loadGoalRows(query.goalIds).filter((row) => row.archivedAt === null)
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

  // walk to now, not the requested end: later buckets still have to be summed
  // for the back-projection, then dropped from the result below
  const fromSec = query.dateStart ?? Math.min(...rows.map((r) => r.startedAt))
  const buckets = bucketsUpToNow(query.timeGrain, fromSec)
  if (buckets.length === 0) return { rows: [], currencies }

  // one second before the first kept bucket begins, so its own flows are in the
  // set; taken from the buckets rather than fromSec, which the cap may have passed
  const sinceSec =
    Math.floor(
      STEPPERS[query.timeGrain].start(new Date(buckets[0].endSec * 1000)).getTime() / 1000
    ) - 1
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
