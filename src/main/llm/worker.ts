// Runs as a dedicated Electron utilityProcess. This is the ONLY file that
// imports node-llama-cpp: the main process and renderer never touch it
// directly, so a crash or heavy generation here can't take down the UI.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import {
  getLlama,
  createModelDownloader,
  defineChatSessionFunction,
  LlamaChatSession,
  LlamaLogLevel,
  Gemma4ChatWrapper,
  type ChatHistoryItem,
  type Llama,
  type LlamaModel,
  type LlamaContext
} from 'node-llama-cpp'
import { CHAT_CONTEXT_SIZE, LLM_MODEL } from '@shared/llm'
import type { QueryToolResult } from '@shared/chat'
import type {
  ChatFunctionCallRecord,
  ChatGenerationResult,
  WorkerCommand,
  WorkerMessage
} from './protocol'
import {
  MAX_ROWS,
  MAX_TOOL_CALLS_PER_TURN,
  scopeViewsDdl,
  shapeResult,
  validateQuerySql,
  type ChatToolScope
} from './sql-tool'

const modelsDir: string = (() => {
  const dir = process.env.LLM_MODELS_DIR
  if (!dir) throw new Error('LLM_MODELS_DIR is not set')
  return dir
})()
fs.mkdirSync(modelsDir, { recursive: true })

const dbPath: string = (() => {
  const p = process.env.SHMONEY_DB_PATH
  if (!p) throw new Error('SHMONEY_DB_PATH is not set')
  return p
})()

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
      // console.* is this utility process's log transport: stdio is piped, and
      // the manager forwards it into the app's scrubbed log file
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

// chat runs on its own (larger) context and session, created lazily on the
// first chat turn: the shared `generate` session resets its history per call,
// while chat replaces its history per turn — keeping them separate means the
// two modes can never leak state into each other
interface ChatSessionState {
  context: LlamaContext
  session: LlamaChatSession
}
let chatLoaded: ChatSessionState | null = null

// the in-flight download. `canceled` lets us tell a user cancel apart from a real
// failure: aborting can make download() either resolve or reject, so the outcome
// is decided by this flag, not by whether the promise threw.
let activeDownload: { abortController: AbortController; canceled: boolean } | null = null

// the controller for the generate currently running, so abortGenerate can stop it
let activeGeneration: AbortController | null = null

// the chat query tool's own connection to the app database, opened lazily on
// the first chat turn. It reads the same WAL file main writes; writes are
// blocked by PRAGMA query_only except inside refreshScopeViews' DDL window.
let toolDb: Database.Database | null = null

function ensureToolDb(): Database.Database {
  if (toolDb) return toolDb
  toolDb = new Database(dbPath, { fileMustExist: true })
  toolDb.pragma('query_only = ON')
  return toolDb
}

function closeToolDb(): void {
  toolDb?.close()
  toolDb = null
}

/**
 * (Re)build the temp views the model queries through, narrowed to the turn's
 * scope. query_only lifts only around our own DDL; a failure here must fail
 * the turn (never prompt against a stale scope), so no try/catch beyond
 * restoring the pragma.
 */
function refreshScopeViews(scope: ChatToolScope): void {
  const db = ensureToolDb()
  db.pragma('query_only = OFF')
  try {
    for (const ddl of scopeViewsDdl(scope)) db.exec(ddl)
  } finally {
    db.pragma('query_only = ON')
  }
}

/**
 * Execute one model-supplied query. Never throws: a thrown error would abort
 * the whole generation, so every failure becomes an { ok: false } result the
 * model can read and correct.
 */
function runQuery(sql: string): QueryToolResult {
  const started = Date.now()
  const fail = (error: string): QueryToolResult => ({
    ok: false,
    error,
    durationMs: Date.now() - started
  })
  const valid = validateQuerySql(sql)
  if (!valid.ok) return fail(valid.error)
  try {
    // prepare() also rejects multi-statement strings, and stmt.readonly
    // catches writes the keyword check can't see (e.g. CTE-wrapped mutations)
    const stmt = ensureToolDb().prepare(sql)
    if (!stmt.readonly || !stmt.reader) return fail('Only read-only SELECT queries are allowed.')
    stmt.raw(true)
    const rows: unknown[][] = []
    // pull at most one row past the cap: enough for shapeResult to see the
    // truncation, without streaming an unbounded result through memory
    for (const row of stmt.iterate()) {
      rows.push(row as unknown[])
      if (rows.length > MAX_ROWS) break
    }
    const columns = stmt.columns().map((c) => c.name)
    return shapeResult(columns, rows, Date.now() - started)
  } catch (err) {
    return fail(String((err as Error)?.message ?? err))
  }
}

function modelFilePath(fileName: string): string {
  return path.join(modelsDir, fileName)
}

function post(message: WorkerMessage): void {
  process.parentPort.postMessage(message)
}

async function disposeLoaded(): Promise<void> {
  // the tool connection follows the model's lifecycle: idle unload closes it
  // too, and the next chat turn reopens it
  closeToolDb()
  if (!loaded) return
  // sessions first, then contexts, then the model: on Windows the file stays
  // locked while anything still maps it
  if (chatLoaded) {
    chatLoaded.session.dispose()
    await chatLoaded.context.dispose()
    chatLoaded = null
  }
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

  // Verify the finished file against the pinned hash before ever reporting it
  // as downloaded; a mismatched file (corrupted or tampered upstream) is
  // deleted on the spot so it can never be loaded.
  if (!record.canceled) {
    const filePath = modelFilePath(LLM_MODEL.fileName)
    post({ event: 'status', status: { stage: 'verifying', error: null } })
    const hash = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(filePath), hash)
    const actual = hash.digest('hex')
    if (actual !== LLM_MODEL.sha256) {
      await fs.promises.rm(filePath, { force: true })
      const error = 'Downloaded model failed checksum verification and was deleted'
      post({ event: 'status', status: { stage: 'error', error } })
      throw new Error(`${error} (expected ${LLM_MODEL.sha256}, got ${actual})`)
    }
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

async function ensureChatSession(): Promise<LlamaChatSession> {
  if (!loaded) throw new Error('No model loaded')
  if (chatLoaded) return chatLoaded.session
  const context = await loaded.model.createContext({ contextSize: CHAT_CONTEXT_SIZE })
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    chatWrapper: new Gemma4ChatWrapper()
  })
  chatLoaded = { context, session }
  return session
}

async function handleChat(
  id: number,
  history: ChatHistoryItem[],
  prompt: string,
  toolScope: ChatToolScope
): Promise<ChatGenerationResult> {
  // register as the active generation before any await so an abortGenerate
  // that lands while the chat context is still being created isn't lost
  const controller = new AbortController()
  activeGeneration = controller
  try {
    const session = await ensureChatSession()
    if (controller.signal.aborted)
      return { text: '', reasoning: '', reasoningMs: 0, interrupted: true, functionCalls: [] }
    refreshScopeViews(toolScope)
    // the whole prior conversation is replaced per turn (stateless worker: the
    // feature owns history in the DB), so switching conversations needs nothing
    session.setChatHistory(history)

    const functionCalls: ChatFunctionCallRecord[] = []
    // handler invocations arrive in generation order, so this counter lines up
    // with onFunctionCallParamsChunk's callIndex (params are grammar-constrained
    // to the schema, so a generated call can't fail parsing and skip its handler)
    let handledCalls = 0
    const functions = {
      query: defineChatSessionFunction({
        description: `Run one read-only SQLite SELECT statement against the finance database. Results are capped at ${MAX_ROWS} rows, so aggregate or LIMIT in SQL.`,
        params: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'A single SQLite SELECT (or WITH ... SELECT) statement.'
            }
          }
        },
        handler({ sql }) {
          const callId = handledCalls++
          post({ event: 'chatToolCall', id, callId, phase: 'start', sql })
          const result =
            handledCalls > MAX_TOOL_CALLS_PER_TURN
              ? {
                  ok: false,
                  error:
                    'The query budget for this reply is used up; answer with the data you already have.',
                  durationMs: 0
                }
              : runQuery(sql)
          functionCalls.push({ name: 'query', args: { sql }, result })
          post({ event: 'chatToolCall', id, callId, phase: 'end', result })
          return result
        }
      })
    }
    // the chat wrapper routes the model's chain of thought into segments, so
    // prompt() resolves with the answer alone; thought text and timing are
    // collected here from the segment chunks
    let reasoning = ''
    let reasoningMs = 0
    let segmentStart: number | null = null
    // stopOnAbortSignal makes an abort return the text generated so far
    // instead of throwing, so a stopped reply still reaches the DB
    const text = await session.prompt(prompt, {
      signal: controller.signal,
      stopOnAbortSignal: true,
      functions,
      // one call at a time keeps the params stream, handler invocations, and
      // the transcript's card order trivially aligned
      maxParallelFunctionCalls: 1,
      onFunctionCallParamsChunk: (chunk) =>
        post({
          event: 'chatToolCall',
          id,
          callId: chunk.callIndex,
          phase: 'params',
          chunk: chunk.paramsChunk
        }),
      onResponseChunk: (chunk) => {
        if (chunk.type === 'segment') {
          if (chunk.segmentStartTime) segmentStart = chunk.segmentStartTime.getTime()
          if (chunk.text) {
            reasoning += chunk.text
            post({ event: 'chatChunk', id, text: chunk.text, kind: 'reasoning' })
          }
          if (chunk.segmentEndTime && segmentStart !== null) {
            reasoningMs += chunk.segmentEndTime.getTime() - segmentStart
            segmentStart = null
          }
        } else if (chunk.text) {
          post({ event: 'chatChunk', id, text: chunk.text, kind: 'text' })
        }
      }
    })
    // an abort mid-thought leaves the segment open; count the time until now
    if (segmentStart !== null) reasoningMs += Date.now() - segmentStart
    return { text, reasoning, reasoningMs, interrupted: controller.signal.aborted, functionCalls }
  } finally {
    if (activeGeneration === controller) activeGeneration = null
  }
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
    case 'chat':
      return handleChat(command.id, command.history, command.prompt, command.toolScope)
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
