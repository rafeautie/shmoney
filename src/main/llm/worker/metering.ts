import type { LlamaChatSession } from 'node-llama-cpp'
import type { GenerationStopReason, ModelId } from '@shared/llm'
import { createUsageMeter, type UsageMeter } from '../usage-meter'

// time spent loading a model since the last request, charged to the next
// request's stats as its loadMs
let pendingLoadMs: number | null = null

export function chargeLoadMs(ms: number): void {
  pendingLoadMs = (pendingLoadMs ?? 0) + ms
}

/** a usage meter over the session's sequence, charging it any pending load time */
export function meterFor(session: LlamaChatSession, modelId: ModelId): UsageMeter {
  const sequence = session.sequence
  const startTokens = sequence.tokenMeter.getState()
  const loadMs = pendingLoadMs
  pendingLoadMs = null
  return createUsageMeter({
    modelId,
    now: Date.now,
    readTokens: () => {
      const used = sequence.tokenMeter.diff(startTokens)
      return { inputTokens: used.usedInputTokens, outputTokens: used.usedOutputTokens }
    },
    readContext: () => ({
      contextTokens: sequence.nextTokenIndex,
      contextSize: sequence.context.contextSize
    }),
    loadMs
  })
}

type LibraryStopReason = Awaited<ReturnType<LlamaChatSession['promptWithMeta']>>['stopReason']

export function stopReasonOf(reason: LibraryStopReason): GenerationStopReason {
  switch (reason) {
    case 'eogToken':
    case 'stopGenerationTrigger':
    case 'customStopTrigger':
      return 'endOfTurn'
    case 'maxTokens':
      return 'maxTokens'
    case 'abort':
      return 'aborted'
    default:
      return 'other'
  }
}
