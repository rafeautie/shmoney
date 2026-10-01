// The generic inference primitive every non-chat feature is built on.
import type { Llama, LlamaChatSession } from 'node-llama-cpp'
import type { GenerationStopReason, ModelId } from '@shared/llm'
import { meterFor, stopReasonOf } from './metering'
import { postFinalStats } from './port'
import { ensureLlama } from './runtime'

// The worker protocol carries the schema as a plain object so the manager needn't
// import node-llama-cpp; cast to the library's schema type here.
type CompiledGrammar = Awaited<ReturnType<Llama['createGrammarForJsonSchema']>>

async function compileGrammar(schema: object): Promise<CompiledGrammar> {
  const llamaInstance = await ensureLlama()
  return llamaInstance.createGrammarForJsonSchema(
    schema as Parameters<Llama['createGrammarForJsonSchema']>[0]
  )
}

// Compiling a JSON schema into llama.cpp grammar rules isn't free, and a batch
// categorize sends the same schema for every row, so cache the most recent
// grammar and reuse it when the schema repeats. The grammar is bound to the
// persistent Llama instance (not the model), so it survives load/unload.
let grammarCache: { key: string; grammar: Awaited<ReturnType<typeof compileGrammar>> } | null = null

async function grammarFor(schema: object): Promise<Awaited<ReturnType<typeof compileGrammar>>> {
  const key = JSON.stringify(schema)
  if (grammarCache && grammarCache.key === key) return grammarCache.grammar
  const grammar = await compileGrammar(schema)
  grammarCache = { key, grammar }
  return grammar
}

export async function runGenerate(
  id: number,
  session: LlamaChatSession,
  modelId: ModelId,
  prompt: string,
  schema: object | undefined,
  signal: AbortSignal
): Promise<unknown> {
  // each call starts from an empty history, so completed generates are
  // stateless and an aborted one leaves nothing behind
  session.resetChatHistory()
  const meter = meterFor(session, modelId)
  let stopReason: GenerationStopReason = 'error'
  try {
    // Constrain decoding to the JSON schema so the response is always parseable.
    const grammar = schema ? await grammarFor(schema) : undefined
    // an abort makes promptWithMeta throw, which surfaces as a rejected reply
    const result = await session.promptWithMeta(prompt, {
      grammar,
      signal,
      onResponseChunk: () => meter.sample()
    })
    stopReason = stopReasonOf(result.stopReason)
    return grammar ? grammar.parse(result.responseText) : result.responseText
  } catch (err) {
    if (signal.aborted) stopReason = 'aborted'
    throw err
  } finally {
    postFinalStats(id, meter.finish(stopReason))
  }
}
