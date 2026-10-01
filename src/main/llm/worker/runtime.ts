// The one model in memory and its lifecycle. Every caller goes through the
// worker's serial queue (see worker.ts), so a load, an unload and a generation
// never interleave.
import fs from 'node:fs'
import {
  getLlama,
  LlamaChatSession,
  LlamaLogLevel,
  InsufficientMemoryError,
  Gemma4ChatWrapper,
  QwenChatWrapper,
  type ChatWrapper,
  type Llama,
  type LlamaModel,
  type LlamaContext
} from 'node-llama-cpp'
import { CONTEXT_SIZE, LLM_MODELS, type LlmModel, type ModelId } from '@shared/llm'
import { createChatSession } from './chat-turn'
import { chargeLoadMs } from './metering'
import { modelFilePath } from './models'
import { post, postRuntime } from './port'
import { closeToolDb } from './tool-db'

// llama.cpp prints a handful of loud-but-expected lines on every load; each is
// self-declared noise, so we drop them and forward everything else. Two groups:
//
//  - Memory fitting: node-llama-cpp probes several context sizes and llama.cpp
//    logs the failed probes (e.g. Gemma's "requires ctx_other to be set (this
//    warning is normal during memory fitting)"), plus node-llama-cpp's own
//    "falling back to estimation heuristic" notice.
//  - Vocab self-correction: the Gemma GGUFs mark a few special tokens
//    (<|tool_response>, </s>) as normal-type and leave </s> in the
//    end-of-generation set, so llama.cpp reclassifies them to control-type and
//    drops </s> from the EOG list. The quirk is baked into the file, so this
//    recurs each load; the corrections are exactly what we want (control tokens
//    stay hidden, a stray </s> can't truncate a reply), so the warnings are pure
//    noise. Fixing them for real would mean re-converting the GGUF upstream.
function isBenignLlamaLog(message: string): boolean {
  return (
    message.includes('normal during memory fitting') ||
    message.includes('Falling back to estimation heuristic') ||
    message.includes('control-looking token') ||
    message.includes('token from EOG list')
  )
}

let llama: Llama | null = null
export async function ensureLlama(): Promise<Llama> {
  if (!llama) {
    llama = await getLlama({
      gpu: 'auto',
      // console.* is this utility process's log transport: stdio is piped, and
      // the manager forwards it into the app's scrubbed log file
      logger: (level, message) => {
        if (isBenignLlamaLog(message)) return
        if (level === LlamaLogLevel.error || level === LlamaLogLevel.fatal) console.error(message)
        else if (level === LlamaLogLevel.warn) console.warn(message)
        else console.log(message)
      }
    })
  }
  return llama
}

// A load creates the model, its one context and both sessions, or nothing: a
// context created later could fail mid-conversation on memory the load already
// handed to GPU layers. Generate and chat share the context's one sequence;
// the serial queue keeps them from overlapping, and each request replaces its
// session's history, so neither mode inherits the other's state.
export interface LoadedModel {
  modelId: ModelId
  model: LlamaModel
  context: LlamaContext
  generateSession: LlamaChatSession
  chatSession: LlamaChatSession
}
let loaded: LoadedModel | null = null

// node-llama-cpp 3.19 never disposes a context whose creation failed, and that
// orphan keeps a hold on its model: once it is garbage-collected,
// model.dispose() never settles and the model is left half-disposed ("Object
// is disposed" on every later use). A fresh process is the only sure way to
// give that memory back, so after a failed load or dispose the worker asks the
// manager to restart it once nothing is in flight.
let recycleRequested = false
export function requestRecycle(reason: string): void {
  if (recycleRequested) return
  recycleRequested = true
  console.warn(`llm worker recycle requested: ${reason}`)
  post({ event: 'recycle' })
}

const DISPOSE_TIMEOUT_MS = 10_000

// Explicit per family rather than resolveChatWrapper's auto-detection, so each
// mode's reasoning behavior is ours to decide. Qwen3.5 thinks freely in chat
// (the thought chain shows it) but is steered off thinking for generate, whose
// callers parse the reply.
function chatWrapperFor(model: LlmModel, mode: 'generate' | 'chat'): ChatWrapper {
  switch (model.family) {
    case 'gemma4':
      return new Gemma4ChatWrapper()
    case 'qwen35':
      return new QwenChatWrapper({
        variation: '3.5',
        thoughts: mode === 'chat' ? 'auto' : 'discourage'
      })
  }
}

async function disposeLoaded(): Promise<void> {
  // the tool connection follows the model's lifecycle: idle unload closes it
  // too, and the next chat turn reopens it
  closeToolDb()
  // detached before any await, so a dispose that throws or hangs can never
  // leave a half-disposed model looking loaded
  const target = loaded
  loaded = null
  if (!target) return
  // sessions first, then the context, then the model: on Windows the file
  // stays locked while anything still maps it
  const dispose = async (): Promise<void> => {
    target.chatSession.dispose()
    target.generateSession.dispose()
    await target.context.dispose()
    await target.model.dispose()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      dispose(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), DISPOSE_TIMEOUT_MS)
      })
    ])
  } catch (err) {
    requestRecycle(`dispose failed: ${String((err as Error)?.message ?? err)}`)
  } finally {
    clearTimeout(timer)
  }
  postRuntime(target.modelId, 'unloaded')
}

/** a load failure in words the user can act on; the raw error goes to the log */
function loadErrorMessage(modelId: ModelId, err: unknown): string {
  const { label } = LLM_MODELS[modelId]
  const raw = String((err as Error)?.message ?? err)
  if (
    err instanceof InsufficientMemoryError ||
    /failed to create context|out of (device )?memory|failed to allocate/i.test(raw)
  ) {
    return `${label} doesn't fit in the memory this computer has free right now. Pick a smaller model in Settings, or close other apps using the graphics card and try again.`
  }
  return `${label} couldn't be loaded: ${raw}`
}

async function load(modelId: ModelId): Promise<LoadedModel> {
  const model = LLM_MODELS[modelId]
  const filePath = modelFilePath(modelId)
  if (!fs.existsSync(filePath)) throw new Error(`${model.label} is not downloaded yet`)

  postRuntime(modelId, 'loading')
  const loadStarted = Date.now()
  try {
    const llamaInstance = await ensureLlama()
    const llamaModel = await llamaInstance.loadModel({
      modelPath: filePath,
      // offload only as many layers as leave room for the context below; the
      // default fits a small context and starves the real one
      gpuLayers: { fitContext: { contextSize: CONTEXT_SIZE } }
    })
    const context = await llamaModel.createContext({ contextSize: CONTEXT_SIZE })
    const sequence = context.getSequence()
    loaded = {
      modelId,
      model: llamaModel,
      context,
      generateSession: new LlamaChatSession({
        contextSequence: sequence,
        chatWrapper: chatWrapperFor(model, 'generate')
      }),
      chatSession: createChatSession(sequence, chatWrapperFor(model, 'chat'))
    }
    console.log(
      `loaded ${modelId}: ${llamaModel.gpuLayers}/${llamaModel.fileInsights.totalLayers} layers on GPU, flash attention ${context.flashAttention}, batch ${context.batchSize}`
    )
    chargeLoadMs(Date.now() - loadStarted)
    postRuntime(modelId, 'ready')
    return loaded
  } catch (err) {
    // nothing partial is disposed here: a failed context pins its model (see
    // requestRecycle), so the fresh process is what frees it
    console.error(`model load failed: ${String((err as Error)?.stack ?? err)}`)
    const message = loadErrorMessage(modelId, err)
    postRuntime(modelId, 'unloaded', message)
    requestRecycle('load failed')
    throw new Error(message)
  }
}

/** the model a request runs on, loading it (and dropping any other) first */
export async function ensureLoaded(modelId: ModelId): Promise<LoadedModel> {
  if (loaded?.modelId === modelId) return loaded
  // one model in memory at a time, so the previous one's RAM is freed first
  await disposeLoaded()
  return load(modelId)
}

/** drop the model in memory, or only `modelId` when given */
export async function unload(modelId?: ModelId): Promise<void> {
  if (modelId === undefined || loaded?.modelId === modelId) await disposeLoaded()
}

export function isLoaded(): boolean {
  return loaded !== null
}
