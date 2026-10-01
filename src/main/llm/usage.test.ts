import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { GenerationStats } from '@shared/llm'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code against the real migrations
vi.mock('../db', () => import('../../demo/db'))

const { runMigrations } = await import('../../demo/db')
const { getUsageSummary, recordUsage } = await import('./usage')

const stats = (over: Partial<GenerationStats> = {}): GenerationStats => ({
  modelId: 'qwen35-4b',
  inputTokens: 1000,
  outputTokens: 100,
  decodeTokens: 90,
  decodeMs: 3000,
  ttftMs: 500,
  prefillMs: 400,
  toolMs: 0,
  totalMs: 3500,
  loadMs: null,
  contextTokens: 1100,
  contextSize: 12288,
  stopReason: 'endOfTurn',
  ...over
})

const NOW = new Date(2026, 8, 30, 15).getTime()
const DAY = 86_400_000

beforeAll(async () => {
  await runMigrations()
  recordUsage('chat', stats({ loadMs: 2000 }), NOW - 2 * DAY)
  recordUsage('chat', stats({ stopReason: 'aborted', ttftMs: null, outputTokens: 0 }), NOW - DAY)
  recordUsage('categorize', stats({ modelId: 'e4b', inputTokens: 300, outputTokens: 10 }), NOW)
  recordUsage('categorize', stats({ modelId: 'e4b', stopReason: 'error' }), NOW - 40 * DAY)
})

describe('usage summary', () => {
  it('sums every request when never reset', () => {
    const { totals, firstAt } = getUsageSummary(null, NOW)
    expect(totals.requests).toBe(4)
    expect(totals.inputTokens).toBe(3300)
    expect(totals.outputTokens).toBe(210)
    expect(totals.ttftCount).toBe(3)
    expect(totals.loads).toBe(1)
    expect(totals.loadMs).toBe(2000)
    expect(totals.interrupted).toBe(1)
    expect(totals.errors).toBe(1)
    expect(firstAt).toBe(NOW - 40 * DAY)
  })

  it('counts only requests from the reset point on', () => {
    const { totals, byFeature, since } = getUsageSummary(NOW - DAY - 1, NOW)
    expect(since).toBe(NOW - DAY - 1)
    expect(totals.requests).toBe(2)
    expect(byFeature.map((f) => [f.feature, f.requests]).sort()).toEqual([
      ['categorize', 1],
      ['chat', 1]
    ])
  })

  it('groups by model and by local day within the window', () => {
    const { byModel, daily } = getUsageSummary(null, NOW)
    expect(byModel.map((m) => [m.modelId, m.requests])).toEqual([
      ['e4b', 2],
      ['qwen35-4b', 2]
    ])
    // the 40-day-old request is outside the 30-day window
    expect(daily).toHaveLength(3)
    expect(daily.at(-1)).toEqual({ day: '2026-09-30', feature: 'categorize', tokens: 310 })
  })
})
