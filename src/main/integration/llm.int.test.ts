import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_ID,
  LLM_MODELS,
  MODEL_IDS,
  type GenerationStopReason,
  type LlmFeature,
  type LlmStatus
} from '@shared/llm'
import { db } from '../../demo/db'
import { llmUsage } from '../db/schema'
import { api } from './harness/api'
import { fakeLlm } from './harness/fakes/llm'

const GIB = 1024 ** 3

function statusPushes(): { seen: LlmStatus[]; stop: () => void } {
  const seen: LlmStatus[] = []
  const stop = api.llm.onStatusChanged((status) => seen.push(status))
  return { seen, stop }
}

describe('model lifecycle', () => {
  it('reports a fresh install: nothing downloaded, the default model selected', async () => {
    const status = await api.llm.getStatus()
    expect(status.selected).toBe(DEFAULT_MODEL_ID)
    expect(status.runtime).toBe('unloaded')
    expect(Object.keys(status.models).sort()).toEqual([...MODEL_IDS].sort())
    for (const id of MODEL_IDS)
      expect(status.models[id]).toEqual({ stage: 'notDownloaded', error: null })
  })

  it('reports disk sizes only for models on disk', async () => {
    expect(Object.values(await api.llm.getDiskSizes())).toEqual(MODEL_IDS.map(() => null))
    fakeLlm.setStage('downloaded', 'e4b')
    const sizes = await api.llm.getDiskSizes()
    expect(sizes.e4b).toBe(LLM_MODELS.e4b.downloadBytes)
    expect(sizes.e2b).toBeNull()
  })

  it('reports the hardware the machine has', async () => {
    expect(await api.llm.getHardware()).toEqual({ totalRamBytes: 32 * GIB })
    fakeLlm.setRam(8 * GIB)
    expect(await api.llm.getHardware()).toEqual({ totalRamBytes: 8 * GIB })
  })

  it('download returns the new status and pushes it', async () => {
    const { seen, stop } = statusPushes()
    const status = await api.llm.download('e2b')
    stop()

    expect(status.models.e2b.stage).toBe('downloaded')
    expect(status.selected).toBe('e2b')
    expect(seen).toEqual([status])
    expect((await api.llm.getStatus()).models.e2b.stage).toBe('downloaded')
  })

  it('selectModel returns the new status and pushes it', async () => {
    const { seen, stop } = statusPushes()
    const status = await api.llm.selectModel('qwen35-9b')
    stop()

    expect(status.selected).toBe('qwen35-9b')
    expect(seen).toEqual([status])
    expect((await api.llm.getStatus()).selected).toBe('qwen35-9b')
  })

  it('deleteModel returns the new status and pushes it', async () => {
    fakeLlm.setStage('downloaded', 'e2b')
    const { seen, stop } = statusPushes()
    const status = await api.llm.deleteModel('e2b')
    stop()

    expect(status.models.e2b.stage).toBe('notDownloaded')
    expect(seen).toEqual([status])
    expect((await api.llm.getDiskSizes()).e2b).toBeNull()
  })

  it('cancelDownload reaches the manager and resolves with nothing', async () => {
    fakeLlm.setStage('downloading', 'qwen35-2b')
    await expect(api.llm.cancelDownload('qwen35-2b')).resolves.toBeUndefined()
    expect((await api.llm.getStatus()).models['qwen35-2b'].stage).toBe('notDownloaded')
  })

  it('stops pushing status once the subscription is cancelled', async () => {
    const { seen, stop } = statusPushes()
    stop()
    await api.llm.selectModel('e4b')
    expect(seen).toEqual([])
  })

  it('every model id the registry knows is accepted', async () => {
    for (const id of MODEL_IDS) {
      expect((await api.llm.selectModel(id)).selected).toBe(id)
    }
  })
})

describe('input validation', () => {
  const unknown = 'gpt-9000' as never

  it('rejects an unknown model id on every model channel, leaving status untouched', async () => {
    const before = await api.llm.getStatus()
    const { seen, stop } = statusPushes()

    await expect(api.llm.download(unknown)).rejects.toThrow()
    await expect(api.llm.cancelDownload(unknown)).rejects.toThrow()
    await expect(api.llm.deleteModel(unknown)).rejects.toThrow()
    await expect(api.llm.selectModel(unknown)).rejects.toThrow()
    stop()

    expect(await api.llm.getStatus()).toEqual(before)
    expect(seen).toEqual([])
  })

  it('rejects a non-string model id', async () => {
    await expect(api.llm.selectModel(7 as never)).rejects.toThrow()
    await expect(api.llm.selectModel(undefined as never)).rejects.toThrow()
  })

  it('rejects a usage cutoff that is not a number or null', async () => {
    await expect(api.llm.getUsage('yesterday' as never)).rejects.toThrow()
    await expect(api.llm.getUsage(undefined as never)).rejects.toThrow()
  })
})

type UsageRow = typeof llmUsage.$inferInsert

const DAY = 24 * 60 * 60 * 1000

/** local noon `daysAgo` days back, as unix milliseconds */
function noonAgo(daysAgo: number): number {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.getTime()
}

/** the local 'YYYY-MM-DD' of a moment, the form the daily series uses */
function localDay(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function usage(over: Partial<UsageRow> & { createdAt: number }): void {
  db.insert(llmUsage)
    .values({
      modelId: 'e2b',
      feature: 'chat',
      stopReason: 'endOfTurn',
      inputTokens: 100,
      outputTokens: 50,
      decodeTokens: 50,
      decodeMs: 1_000,
      prefillMs: 200,
      toolMs: 0,
      totalMs: 1_300,
      ttftMs: 250,
      loadMs: null,
      ...over
    })
    .run()
}

describe('getUsage', () => {
  beforeEach(() => {
    db.delete(llmUsage).run()
  })

  it('is all zeros and empty with no requests logged', async () => {
    const summary = await api.llm.getUsage(null)
    expect(summary.since).toBeNull()
    expect(summary.firstAt).toBeNull()
    expect(summary.totals).toEqual({
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      decodeTokens: 0,
      decodeMs: 0,
      prefillMs: 0,
      totalMs: 0,
      ttftMs: 0,
      ttftCount: 0,
      loads: 0,
      loadMs: 0,
      interrupted: 0,
      errors: 0
    })
    expect(summary.byModel).toEqual([])
    expect(summary.byFeature).toEqual([])
    expect(summary.daily).toEqual([])
  })

  it('sums every column into the totals', async () => {
    const at = noonAgo(1)
    usage({ createdAt: at, ttftMs: 100, loadMs: 4_000 })
    usage({
      createdAt: at + 1,
      inputTokens: 300,
      outputTokens: 70,
      decodeTokens: 60,
      decodeMs: 2_000,
      prefillMs: 500,
      totalMs: 2_600,
      ttftMs: null
    })
    usage({ createdAt: at + 2, stopReason: 'aborted', loadMs: 1_000 })
    usage({ createdAt: at + 3, stopReason: 'error' })
    usage({ createdAt: at + 4, stopReason: 'maxTokens' })

    const { totals, firstAt } = await api.llm.getUsage(null)

    expect(firstAt).toBe(at)
    expect(totals).toEqual({
      requests: 5,
      inputTokens: 100 + 300 + 100 + 100 + 100,
      outputTokens: 50 + 70 + 50 + 50 + 50,
      decodeTokens: 50 + 60 + 50 + 50 + 50,
      decodeMs: 1_000 + 2_000 + 1_000 + 1_000 + 1_000,
      prefillMs: 200 + 500 + 200 + 200 + 200,
      totalMs: 1_300 + 2_600 + 1_300 + 1_300 + 1_300,
      ttftMs: 100 + 250 * 3,
      ttftCount: 4,
      loads: 2,
      loadMs: 5_000,
      interrupted: 1,
      errors: 1
    })
  })

  it('groups by model, busiest first, and keeps a model dropped from the registry', async () => {
    const at = noonAgo(1)
    usage({ createdAt: at, modelId: 'qwen35-4b' })
    usage({ createdAt: at + 1, modelId: 'e2b' })
    usage({ createdAt: at + 2, modelId: 'qwen35-4b' })
    usage({ createdAt: at + 3, modelId: 'retired-model' })

    const { byModel } = await api.llm.getUsage(null)

    expect(byModel.map((m) => [m.modelId, m.requests])).toEqual([
      ['qwen35-4b', 2],
      ['e2b', 1],
      ['retired-model', 1]
    ])
    expect(byModel[0]).toMatchObject({ inputTokens: 200, outputTokens: 100 })
  })

  it('groups by feature, busiest first, with the stop reasons counted per feature', async () => {
    const at = noonAgo(1)
    const row = (feature: LlmFeature, stopReason: GenerationStopReason, n: number): void =>
      usage({ createdAt: at + n, feature, stopReason })
    row('categorize', 'endOfTurn', 1)
    row('categorize', 'endOfTurn', 2)
    row('categorize', 'error', 3)
    row('chat', 'aborted', 4)
    row('ruleTerm', 'endOfTurn', 5)

    const { byFeature } = await api.llm.getUsage(null)

    expect(byFeature.map((f) => [f.feature, f.requests])).toEqual([
      ['categorize', 3],
      ['chat', 1],
      ['ruleTerm', 1]
    ])
    expect(byFeature[0]).toMatchObject({ errors: 1, interrupted: 0 })
    expect(byFeature[1]).toMatchObject({ errors: 0, interrupted: 1 })
  })

  it('breaks the daily series down by local day and feature, oldest day first', async () => {
    usage({ createdAt: noonAgo(2), feature: 'chat' })
    usage({ createdAt: noonAgo(2) + 1, feature: 'chat', inputTokens: 10, outputTokens: 5 })
    usage({ createdAt: noonAgo(2) + 2, feature: 'categorize' })
    usage({ createdAt: noonAgo(5), feature: 'chat' })

    const { daily } = await api.llm.getUsage(null)

    const sorted = (rows: typeof daily): typeof daily =>
      [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.feature.localeCompare(b.feature))
    expect(daily.map((d) => d.day)).toEqual(
      [...daily.map((d) => d.day)].sort((a, b) => a.localeCompare(b))
    )
    expect(sorted(daily)).toEqual([
      { day: localDay(noonAgo(5)), feature: 'chat', tokens: 150 },
      { day: localDay(noonAgo(2)), feature: 'categorize', tokens: 150 },
      { day: localDay(noonAgo(2)), feature: 'chat', tokens: 150 + 15 }
    ])
  })

  it('counts older usage in the totals but not the 30-day daily window', async () => {
    usage({ createdAt: noonAgo(29), feature: 'chat' })
    usage({ createdAt: noonAgo(30), feature: 'chat' })
    usage({ createdAt: noonAgo(60), feature: 'chat' })

    const { totals, daily, firstAt } = await api.llm.getUsage(null)

    expect(totals.requests).toBe(3)
    expect(firstAt).toBe(noonAgo(60))
    expect(daily.map((d) => d.day)).toEqual([localDay(noonAgo(29))])
  })

  it('since drops earlier requests from the totals, groups and daily series', async () => {
    usage({ createdAt: noonAgo(10), modelId: 'old-model', feature: 'chat' })
    usage({ createdAt: noonAgo(4), modelId: 'old-model', feature: 'chat' })
    usage({ createdAt: noonAgo(1), modelId: 'e2b', feature: 'categorize' })
    usage({ createdAt: noonAgo(0), modelId: 'e2b', feature: 'categorize' })
    const since = noonAgo(1)

    const summary = await api.llm.getUsage(since)

    expect(summary.since).toBe(since)
    expect(summary.firstAt).toBe(noonAgo(1))
    expect(summary.totals.requests).toBe(2)
    expect(summary.byModel.map((m) => [m.modelId, m.requests])).toEqual([['e2b', 2]])
    expect(summary.byFeature.map((f) => [f.feature, f.requests])).toEqual([['categorize', 2]])
    expect(summary.daily.map((d) => d.day)).toEqual([localDay(noonAgo(1)), localDay(noonAgo(0))])
  })

  it('since is inclusive of a request at exactly that moment', async () => {
    const at = noonAgo(3)
    usage({ createdAt: at - 1 })
    usage({ createdAt: at })
    expect((await api.llm.getUsage(at)).totals.requests).toBe(1)
    expect((await api.llm.getUsage(at + 1)).totals.requests).toBe(0)
  })

  it('a cutoff in the future counts nothing', async () => {
    usage({ createdAt: noonAgo(1) })
    const summary = await api.llm.getUsage(Date.now() + DAY)
    expect(summary.totals.requests).toBe(0)
    expect(summary.firstAt).toBeNull()
    expect(summary.daily).toEqual([])
  })
})
