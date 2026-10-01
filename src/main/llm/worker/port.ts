import type { GenerationStats, ModelId, ModelStage, RuntimeStage } from '@shared/llm'
import type { WorkerMessage } from '../protocol'

export function post(message: WorkerMessage): void {
  process.parentPort.postMessage(message)
}

// the manager assembles the composite LlmStatus; the worker only reports the
// transitions it directly causes: a model's file lifecycle, and the in-memory
// model's runtime lifecycle
export function postModelStage(
  modelId: ModelId,
  stage: ModelStage,
  error: string | null = null
): void {
  post({ event: 'modelStage', modelId, stage, error })
}

export function postRuntime(
  modelId: ModelId,
  stage: RuntimeStage,
  error: string | null = null
): void {
  post({ event: 'runtime', modelId, stage, error })
}

/** a request ended: hand its stats to the manager, which logs them */
export function postFinalStats(id: number, stats: GenerationStats): void {
  post({ event: 'stats', id, stats, final: true })
}
