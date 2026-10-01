import { LLM_MODELS, type GenerationStopReason, type ModelId } from '@shared/llm'

export function formatTps(tps: number): string {
  return `${tps >= 100 ? Math.round(tps).toLocaleString() : tps.toFixed(1)} tok/s`
}

/** "412", "12.3k", "4.1M": for tight spots where the exact count doesn't matter */
export function formatCompactTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** "640ms", "12.4s", "3m 5s", "2h 14m" */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** the registry label, or the raw id for a model since dropped from the registry */
export function modelLabel(modelId: string): string {
  return LLM_MODELS[modelId as ModelId]?.label ?? modelId
}

export const STOP_REASON_LABELS: Record<GenerationStopReason, string> = {
  endOfTurn: 'Finished',
  maxTokens: 'Hit the length limit',
  aborted: 'Stopped',
  error: 'Failed',
  other: 'Ended'
}
