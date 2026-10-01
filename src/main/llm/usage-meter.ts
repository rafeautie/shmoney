// Times one inference request. Token counts come from the context sequence's
// token meter (the library's own count, covering answer text, thinking and
// tool-call tokens alike); this module only decides which wall-clock spans
// count as generation. A span counts when the output count grew across it,
// measured from the previous sample; pause() drops the stamp at a tool call so
// the tool's run and the evaluation of its result never count as generation.
// Whatever isn't generation or a tool run is prompt evaluation (prefill).
//
// Pure module with an injected clock and readers, so it stays testable under
// vitest.
import type { GenerationStats, GenerationStopReason, ModelId } from '@shared/llm'

export interface UsageMeter {
  /** call after any streaming callback; reads the token counts and times the span */
  sample(): void
  /** a tool call is starting: the next span holds its run and result prefill, not generation */
  pause(): void
  addToolMs(ms: number): void
  /** the stats so far, stopReason null */
  snapshot(): GenerationStats
  finish(stopReason: GenerationStopReason): GenerationStats
}

export function createUsageMeter(opts: {
  modelId: ModelId
  now: () => number
  /** tokens used since the request started */
  readTokens: () => { inputTokens: number; outputTokens: number }
  readContext: () => { contextTokens: number; contextSize: number }
  loadMs: number | null
}): UsageMeter {
  const { now, readTokens, readContext } = opts
  const start = now()
  let ttftMs: number | null = null
  let decodeMs = 0
  let decodeTokens = 0
  let toolMs = 0
  let lastOutput = 0
  let lastAt: number | null = null

  const stats = (stopReason: GenerationStopReason | null): GenerationStats => {
    const { inputTokens, outputTokens } = readTokens()
    const totalMs = now() - start
    return {
      modelId: opts.modelId,
      inputTokens,
      outputTokens,
      decodeTokens,
      decodeMs,
      ttftMs,
      prefillMs: Math.max(0, totalMs - decodeMs - toolMs),
      toolMs,
      totalMs,
      loadMs: opts.loadMs,
      ...readContext(),
      stopReason
    }
  }

  const sample = (): void => {
    const t = now()
    const { outputTokens } = readTokens()
    if (outputTokens <= lastOutput) return
    ttftMs ??= t - start
    if (lastAt !== null) {
      decodeMs += t - lastAt
      decodeTokens += outputTokens - lastOutput
    }
    lastAt = t
    lastOutput = outputTokens
  }

  return {
    sample,
    pause(): void {
      // the tokens written up to the call still belong to the span ending now
      sample()
      lastAt = null
    },
    addToolMs(ms): void {
      toolMs += ms
    },
    snapshot: () => stats(null),
    finish: (stopReason) => stats(stopReason)
  }
}
