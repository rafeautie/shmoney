// The usage ledger behind Settings > AI usage: one llm_usage row per inference
// request, written by the manager as each request ends, summarized here in one
// call for the page. Averages are left to the renderer, which derives them
// from these sums the same way it derives a single reply's rates.
import { asc, desc, gte, min, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import {
  LLM_USAGE_DAILY_DAYS,
  type GenerationStats,
  type LlmFeature,
  type LlmUsageSummary,
  type LlmUsageTotals
} from '@shared/llm'
import { db } from '../db'
import { llmUsage } from '../db/schema'

export function recordUsage(feature: LlmFeature, stats: GenerationStats, at = Date.now()): void {
  db.insert(llmUsage)
    .values({
      createdAt: at,
      modelId: stats.modelId,
      feature,
      // a live snapshot never reaches here, but the column can't hold null
      stopReason: stats.stopReason ?? 'other',
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      decodeTokens: stats.decodeTokens,
      decodeMs: Math.round(stats.decodeMs),
      prefillMs: Math.round(stats.prefillMs),
      toolMs: Math.round(stats.toolMs),
      totalMs: Math.round(stats.totalMs),
      ttftMs: stats.ttftMs === null ? null : Math.round(stats.ttftMs),
      loadMs: stats.loadMs === null ? null : Math.round(stats.loadMs)
    })
    .run()
}

const total = (column: AnySQLiteColumn): SQL<number> =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number)

const totalsColumns = {
  requests: sql<number>`count(*)`.mapWith(Number),
  inputTokens: total(llmUsage.inputTokens),
  outputTokens: total(llmUsage.outputTokens),
  decodeTokens: total(llmUsage.decodeTokens),
  decodeMs: total(llmUsage.decodeMs),
  prefillMs: total(llmUsage.prefillMs),
  totalMs: total(llmUsage.totalMs),
  ttftMs: total(llmUsage.ttftMs),
  ttftCount: sql<number>`count(${llmUsage.ttftMs})`.mapWith(Number),
  loads: sql<number>`count(${llmUsage.loadMs})`.mapWith(Number),
  loadMs: total(llmUsage.loadMs),
  interrupted: sql<number>`coalesce(sum(${llmUsage.stopReason} = 'aborted'), 0)`.mapWith(Number),
  errors: sql<number>`coalesce(sum(${llmUsage.stopReason} = 'error'), 0)`.mapWith(Number)
}

/** local midnight `days - 1` days before `now`, so the window holds `days` calendar days */
function windowStart(now: number, days: number): number {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

/** Everything the settings page shows, counting requests from `since` on (null = all). */
export function getUsageSummary(since: number | null, now = Date.now()): LlmUsageSummary {
  const where = since === null ? undefined : gte(llmUsage.createdAt, since)
  const totals: LlmUsageTotals = db.select(totalsColumns).from(llmUsage).where(where).get()!
  const first = db
    .select({ at: min(llmUsage.createdAt) })
    .from(llmUsage)
    .where(where)
    .get()

  const byModel = db
    .select({ modelId: llmUsage.modelId, ...totalsColumns })
    .from(llmUsage)
    .where(where)
    .groupBy(llmUsage.modelId)
    .orderBy(desc(sql`count(*)`), asc(llmUsage.modelId))
    .all()
  const byFeature = db
    .select({ feature: llmUsage.feature, ...totalsColumns })
    .from(llmUsage)
    .where(where)
    .groupBy(llmUsage.feature)
    .orderBy(desc(sql`count(*)`), asc(llmUsage.feature))
    .all()

  const day = sql<string>`date(${llmUsage.createdAt} / 1000, 'unixepoch', 'localtime')`
  const dailyFrom = Math.max(since ?? 0, windowStart(now, LLM_USAGE_DAILY_DAYS))
  const daily = db
    .select({
      day,
      feature: llmUsage.feature,
      tokens: sql<number>`sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens})`.mapWith(Number)
    })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, dailyFrom))
    .groupBy(day, llmUsage.feature)
    .orderBy(asc(day))
    .all()

  return { since, firstAt: first?.at ?? null, totals, byModel, byFeature, daily }
}
