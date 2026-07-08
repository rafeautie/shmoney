// Runs as a dedicated Electron utilityProcess. This is the ONLY file that
// imports node-llama-cpp: the main process and renderer never touch it
// directly, so a crash or heavy generation here can't take down the UI.
import fs from 'node:fs'
import path from 'node:path'
import {
  getLlama,
  createModelDownloader,
  LlamaChatSession,
  LlamaLogLevel,
  Gemma4ChatWrapper,
  type Llama,
  type LlamaModel,
  type LlamaContext
} from 'node-llama-cpp'
import { LLM_MODEL } from '@shared/llm'
import type { WorkerCommand, WorkerMessage } from './protocol'

const modelsDir: string = (() => {
  const dir = process.env.LLM_MODELS_DIR
  if (!dir) throw new Error('LLM_MODELS_DIR is not set')
  return dir
})()
fs.mkdirSync(modelsDir, { recursive: true })

// While fitting a context into memory, node-llama-cpp probes several sizes and
// llama.cpp logs the failed probes loudly - e.g. Gemma's "requires ctx_other to
// be set (this warning is normal during memory fitting)". Both that line and
// node-llama-cpp's own "falling back to estimation heuristic" notice are
// self-declared as expected, so we drop them and forward everything else.
function isBenignFittingLog(message: string): boolean {
  return (
    message.includes('normal during memory fitting') ||
    message.includes('Falling back to estimation heuristic')
  )
}

let llama: Llama | null = null
async function ensureLlama(): Promise<Llama> {
  if (!llama) {
    llama = await getLlama({
      gpu: 'auto',
      logger: (level, message) => {
        if (isBenignFittingLog(message)) return
        if (level === LlamaLogLevel.error || level === LlamaLogLevel.fatal) console.error(message)
        else if (level === LlamaLogLevel.warn) console.warn(message)
        else console.log(message)
      }
    })
  }
  return llama
}

interface LoadedModel {
  model: LlamaModel
  context: LlamaContext
  session: LlamaChatSession
}
let loaded: LoadedModel | null = null

// the in-flight download. `canceled` lets us tell a user cancel apart from a real
// failure: aborting can make download() either resolve or reject, so the outcome
// is decided by this flag, not by whether the promise threw.
let activeDownload: { abortController: AbortController; canceled: boolean } | null = null

// the controller for the generate currently running, so abortGenerate can stop it
let activeGeneration: AbortController | null = null

function modelFilePath(fileName: string): string {
  return path.join(modelsDir, fileName)
}

function post(message: WorkerMessage): void {
  process.parentPort.postMessage(message)
}

async function disposeLoaded(): Promise<void> {
  if (!loaded) return
  loaded.session.dispose()
  await loaded.context.dispose()
  await loaded.model.dispose()
  loaded = null
}

async function handleDownload(): Promise<null> {
  const record = { abortController: new AbortController(), canceled: false }
  activeDownload = record
  post({ event: 'status', status: { stage: 'downloading', error: null } })

  try {
    const downloader = await createModelDownloader({
      modelUri: LLM_MODEL.hfUri,
      dirPath: modelsDir,
      fileName: LLM_MODEL.fileName,
      skipExisting: true,
      onProgress: ({ totalSize, downloadedSize }) =>
        post({
          event: 'downloadProgress',
          progress: { downloadedBytes: downloadedSize, totalBytes: totalSize }
        })
    })
    await downloader.download({ signal: record.abortController.signal })
  } catch (err) {
    // a canceled download can reject; that's not a failure, so fall through to
    // the flag below. Only a genuine error surfaces as an error status.
    if (!record.canceled) {
      post({ event: 'status', status: { stage: 'error', error: String(err) } })
      throw err
    }
  } finally {
    activeDownload = null
  }

  // A cancel removes the partial file, so the model is back to notDownloaded; a
  // real completion is downloaded. Decided by the flag, not the promise outcome.
  post({
    event: 'status',
    status: { stage: record.canceled ? 'notDownloaded' : 'downloaded', error: null }
  })
  return null
}

function handleCancelDownload(): null {
  if (!activeDownload) return null
  activeDownload.canceled = true
  activeDownload.abortController.abort()
  return null
}

async function handleDelete(): Promise<null> {
  // dispose first: on Windows the file stays locked while it's memory-mapped
  if (loaded) await disposeLoaded()
  await fs.promises.rm(modelFilePath(LLM_MODEL.fileName), { force: true })
  post({ event: 'status', status: { stage: 'notDownloaded', error: null } })
  return null
}

async function handleLoad(): Promise<null> {
  const filePath = modelFilePath(LLM_MODEL.fileName)
  if (!fs.existsSync(filePath)) throw new Error('Model is not downloaded yet')

  if (loaded) {
    post({ event: 'status', status: { stage: 'ready', error: null } })
    return null
  }

  post({ event: 'status', status: { stage: 'loading', error: null } })
  try {
    const llamaInstance = await ensureLlama()
    const model = await llamaInstance.loadModel({ modelPath: filePath })
    const context = await model.createContext({ contextSize: LLM_MODEL.contextSize })
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      // Gemma 4 reasons by default; disable it so a prompt returns the answer
      // directly (features like categorize parse the response as JSON).
      chatWrapper: new Gemma4ChatWrapper()
    })
    loaded = { model, context, session }
    post({ event: 'status', status: { stage: 'ready', error: null } })
    return null
  } catch (err) {
    post({ event: 'status', status: { stage: 'error', error: String(err) } })
    throw err
  }
}

async function handleUnload(): Promise<null> {
  if (!loaded) return null
  await disposeLoaded()
  post({ event: 'status', status: { stage: 'downloaded', error: null } })
  return null
}

// The worker protocol carries the schema as a plain object so the manager needn't
// import node-llama-cpp; cast to the library's schema type here.
async function compileGrammar(schema: object) {
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

async function handleGenerate(prompt: string, schema?: object): Promise<unknown> {
  if (!loaded) throw new Error('No model loaded')
  loaded.session.resetChatHistory()

  // aborting the signal makes session.prompt stop and throw, which surfaces as a
  // rejected generate reply; resetChatHistory above clears any half-done state
  const controller = new AbortController()
  activeGeneration = controller
  try {
    if (!schema) return await loaded.session.prompt(prompt, { signal: controller.signal })
    // Constrain decoding to the JSON schema so the response is always parseable.
    const grammar = await grammarFor(schema)
    const result = await loaded.session.prompt(prompt, { grammar, signal: controller.signal })
    return grammar.parse(result)
  } finally {
    if (activeGeneration === controller) activeGeneration = null
  }
}

function handleAbortGenerate(): null {
  activeGeneration?.abort(new Error('Generation cancelled'))
  return null
}

async function dispatch(command: WorkerCommand): Promise<unknown> {
  switch (command.type) {
    case 'download':
      return handleDownload()
    case 'cancelDownload':
      return handleCancelDownload()
    case 'delete':
      return handleDelete()
    case 'load':
      return handleLoad()
    case 'unload':
      return handleUnload()
    case 'generate':
      return handleGenerate(command.prompt, command.schema)
    case 'abortGenerate':
      return handleAbortGenerate()
  }
}

process.parentPort.on('message', (e) => {
  const command = e.data as WorkerCommand
  dispatch(command)
    .then((result) => post({ id: command.id, ok: true, result }))
    .catch((err) =>
      post({ id: command.id, ok: false, error: String((err as Error)?.message ?? err) })
    )
})
