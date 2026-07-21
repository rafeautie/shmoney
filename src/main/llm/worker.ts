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
  type ChatSessionModelFunctions,
  type Llama,
  type LlamaModel,
  type LlamaContext
} from 'node-llama-cpp'
import {
  CHAT_CONTEXT_SIZE,
  LLM_MODELS,
  type ModelId,
  type ModelStage,
  type RuntimeStage
} from '@shared/llm'
import type { ChartSpec, ChartToolResult, QueryToolResult } from '@shared/chat'
import type { ChatGenerationResult, WorkerCommand, WorkerMessage } from './protocol'
import { createTurnLog, type TurnLog } from './turn-log'
import {
  MAX_ROWS,
  MAX_TOOL_CALLS_PER_TURN,
  scopeViewsDdl,
  shapeResult,
  validateQuerySql,
  type ChatToolScope
} from './sql-tool'
import { CHART_FUNCTION_PARAMS, chartCallNote, prepareChart } from './chart-tool'
import { CALC_FUNCTION_PARAMS, evaluateExpression } from './calc-tool'
import { RESOLVE_DATES_PARAMS, resolveDateWindow } from './resolve-dates-tool'
import { registerStatFunctions } from './stat-functions'

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
async function ensureLlama(): Promise<Llama> {
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

interface LoadedModel {
  // which registry model is in memory, so a load for a different model swaps it
  // out and delete only disposes when it targets the loaded one
  modelId: ModelId
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

// in-flight downloads, keyed by model so both models can download independently
// and a cancel targets one. `canceled` lets us tell a user cancel apart from a
// real failure: aborting can make download() either resolve or reject, so the
// outcome is decided by this flag, not by whether the promise threw.
const activeDownloads = new Map<ModelId, { abortController: AbortController; canceled: boolean }>()

// the controller for the generate currently running, so abortGenerate can stop it
let activeGeneration: AbortController | null = null

// the chat query tool's own connection to the app database, opened lazily on
// the first chat turn. It reads the same WAL file main writes; writes are
// blocked by PRAGMA query_only except inside refreshScopeViews' DDL window.
let toolDb: Database.Database | null = null

function ensureToolDb(): Database.Database {
  if (toolDb) return toolDb
  const db = new Database(dbPath, { fileMustExist: true })
  // extra aggregates (MEDIAN/PERCENTILE/STDDEV) the model queries through; the
  // cast is because @types/better-sqlite3 types only a single-argument step and
  // cannot describe PERCENTILE's two args (see stat-functions.ts)
  registerStatFunctions((name, def) =>
    db.aggregate(name, def as unknown as Database.AggregateOptions)
  )
  db.pragma('query_only = ON')
  toolDb = db
  return db
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

// the manager assembles the composite LlmStatus; the worker only reports the
// transitions it directly causes — a model's file lifecycle, and the loaded
// model's runtime lifecycle — as these two event kinds.
function postModelStage(modelId: ModelId, stage: ModelStage, error: string | null = null): void {
  post({ event: 'modelStage', modelId, stage, error })
}

function postRuntime(stage: RuntimeStage, error: string | null = null): void {
  post({ event: 'runtime', stage, error })
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

async function handleDownload(modelId: ModelId): Promise<null> {
  const model = LLM_MODELS[modelId]
  const record = { abortController: new AbortController(), canceled: false }
  activeDownloads.set(modelId, record)
  postModelStage(modelId, 'downloading')

  try {
    const downloader = await createModelDownloader({
      modelUri: model.hfUri,
      dirPath: modelsDir,
      fileName: model.fileName,
      skipExisting: true,
      onProgress: ({ totalSize, downloadedSize }) =>
        post({
          event: 'downloadProgress',
          progress: { modelId, downloadedBytes: downloadedSize, totalBytes: totalSize }
        })
    })
    await downloader.download({ signal: record.abortController.signal })
  } catch (err) {
    // a canceled download can reject; that's not a failure, so fall through to
    // the flag below. Only a genuine error surfaces as an error status.
    if (!record.canceled) {
      postModelStage(modelId, 'error', String(err))
      throw err
    }
  } finally {
    activeDownloads.delete(modelId)
  }

  // Verify the finished file against the pinned hash before ever reporting it
  // as downloaded; a mismatched file (corrupted or tampered upstream) is
  // deleted on the spot so it can never be loaded.
  if (!record.canceled) {
    const filePath = modelFilePath(model.fileName)
    postModelStage(modelId, 'verifying')
    const hash = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(filePath), hash)
    const actual = hash.digest('hex')
    if (actual !== model.sha256) {
      await fs.promises.rm(filePath, { force: true })
      const error = 'Downloaded model failed checksum verification and was deleted'
      postModelStage(modelId, 'error', error)
      throw new Error(`${error} (expected ${model.sha256}, got ${actual})`)
    }
  }

  // A cancel removes the partial file, so the model is back to notDownloaded; a
  // real completion is downloaded. Decided by the flag, not the promise outcome.
  postModelStage(modelId, record.canceled ? 'notDownloaded' : 'downloaded')
  return null
}

function handleCancelDownload(modelId: ModelId): null {
  const record = activeDownloads.get(modelId)
  if (!record) return null
  record.canceled = true
  record.abortController.abort()
  return null
}

async function handleDelete(modelId: ModelId): Promise<null> {
  const model = LLM_MODELS[modelId]
  // dispose first, but only when it's this model that's loaded: on Windows the
  // file stays locked while it's memory-mapped
  if (loaded?.modelId === modelId) {
    await disposeLoaded()
    postRuntime('unloaded')
  }
  await fs.promises.rm(modelFilePath(model.fileName), { force: true })
  postModelStage(modelId, 'notDownloaded')
  return null
}

async function handleLoad(modelId: ModelId): Promise<null> {
  const model = LLM_MODELS[modelId]
  const filePath = modelFilePath(model.fileName)
  if (!fs.existsSync(filePath)) throw new Error('Model is not downloaded yet')

  if (loaded) {
    // already the right model in memory: nothing to do
    if (loaded.modelId === modelId) {
      postRuntime('ready')
      return null
    }
    // switching models: drop the old one before loading the new (one model in
    // memory at a time), so the previous selection's RAM is freed first
    await disposeLoaded()
    postRuntime('unloaded')
  }

  postRuntime('loading')
  try {
    const llamaInstance = await ensureLlama()
    const llamaModel = await llamaInstance.loadModel({ modelPath: filePath })
    const context = await llamaModel.createContext({ contextSize: model.contextSize })
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      // Gemma 4 reasons by default; disable it so a prompt returns the answer
      // directly (features like categorize parse the response as JSON).
      chatWrapper: new Gemma4ChatWrapper()
    })
    loaded = { modelId, model: llamaModel, context, session }
    postRuntime('ready')
    return null
  } catch (err) {
    postRuntime('unloaded', String(err))
    throw err
  }
}

async function handleUnload(): Promise<null> {
  if (!loaded) return null
  await disposeLoaded()
  postRuntime('unloaded')
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

// the mutable call bookkeeping the turn's two tool handlers share
interface ChatTurnState {
  // counts handler invocations to enforce the per-turn tool budget
  handledCalls: number
  // what the chart tool draws from: charts always visualize the turn's most
  // recent successful query result, so no result-id plumbing is needed
  lastQuery: QueryToolResult | null
}

/**
 * The tools a chat turn exposes. Handlers report through the turn log alone —
 * it is the single assembler, and its part patches are the stream — so events
 * and persisted parts carry the same shapes by construction, chart currency
 * included. query and chart read/draw the finance data; calc and resolve_dates
 * are database-free helpers for the two things a small model gets wrong on its
 * own — arithmetic and date math — so their results never touch state.lastQuery.
 */
function chatFunctions(ctx: {
  turn: TurnLog
  currency: string | null
  state: ChatTurnState
  // the turn's local date, so resolve_dates shares one "now" with the prompt
  today: string
  // the current call's open-to-settle wall-clock, read at settle time
  callDurationMs: () => number
}): ChatSessionModelFunctions {
  const { turn, currency, state, today, callDurationMs } = ctx
  const overBudget =
    'The tool budget for this reply is used up; answer with the data you already have.'
  return {
    query: defineChatSessionFunction({
      description: `Run one read-only SQLite SELECT statement against the finance database. CTEs and window functions (SUM() OVER, AVG() OVER) are supported. Aggregate in SQL and alias columns clearly; results are capped at ${MAX_ROWS} rows, so aggregate or LIMIT in SQL.`,
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
        state.handledCalls++
        const result =
          state.handledCalls > MAX_TOOL_CALLS_PER_TURN
            ? { ok: false, error: overBudget, durationMs: 0 }
            : runQuery(sql)
        if (result.ok) state.lastQuery = result
        turn.settleCall({ name: 'query', args: { sql }, result }, callDurationMs())
        // Append chartCallNote last, where a chart call is about to be
        // written: the exact legal column names, plus the group recipe when
        // the result is unambiguously long-form. Same reasoning as the chart
        // handler's note below — a rule adjacent to the generation point
        // beats the same rule in the system prompt — and this one carries the
        // model's OWN aliases and result shape, which no system prompt can.
        // In-turn only; replayed calls carry a bare result.
        return result.ok && result.columns?.length && result.rows?.length
          ? { ...result, note: chartCallNote(result.columns, result.rows) }
          : result
      }
    }),
    chart: defineChatSessionFunction({
      description:
        "Show a chart in your reply, drawn from your most recent query result in this reply; results from earlier replies have expired, so query first. Every name you write in x, group and series must appear verbatim in that result's columns array — a name from an example, or one you aliased in an earlier query, is rejected. For a result with one row per x per group, set group to the group column and series to the single measure column; otherwise group is null.",
      params: CHART_FUNCTION_PARAMS,
      handler(params) {
        state.handledCalls++
        // re-shape out of the grammar's readonly inference into the shared type
        const spec: ChartSpec = {
          type: params.type,
          title: params.title,
          x: params.x,
          series: [...params.series],
          group: params.group
        }
        // prepareChart owns the whole spec-to-drawable step (including the
        // group pivot), so its data is the single source of what renders;
        // the model still only ever sees the tiny ok/error result
        const prepared =
          state.handledCalls > MAX_TOOL_CALLS_PER_TURN
            ? ({ ok: false, error: overBudget } as const)
            : prepareChart(spec, state.lastQuery)
        const result: ChartToolResult = prepared.ok
          ? { ok: true }
          : { ok: false, error: prepared.error }
        const display = prepared.ok
          ? { data: prepared.data, currency, series: prepared.series }
          : null
        turn.settleCall({ name: 'chart', args: spec, result, display }, callDurationMs())
        // steer the follow-up prose from the result itself — instructions
        // this close to where the model writes next land far more reliably
        // on a small model than the same words back in the system prompt.
        // In-turn only: replayed chart calls carry a bare ok.
        return result.ok
          ? {
              ...result,
              note: 'The chart is now displayed. Give the takeaway in a sentence or two; do not repeat the charted rows as a table.'
            }
          : result
      }
    }),
    calc: defineChatSessionFunction({
      description:
        'Evaluate one arithmetic expression and get the exact number back. Reach for it whenever an answer needs arithmetic you would otherwise do in your head, above all to combine figures from more than one query result: a percentage of one figure against another, a difference, a ratio, or a growth figure. It does not read the database, so write the actual numbers into the expression rather than column names. Supports + - * / ** and parentheses.',
      params: CALC_FUNCTION_PARAMS,
      handler({ expression }) {
        state.handledCalls++
        const result =
          state.handledCalls > MAX_TOOL_CALLS_PER_TURN
            ? { ok: false, error: overBudget }
            : evaluateExpression(expression)
        turn.settleCall({ name: 'calc', args: { expression }, result }, callDurationMs())
        return result
      }
    }),
    resolve_dates: defineChatSessionFunction({
      description:
        "Turn a relative time period into the exact dates to filter on, so you never compute a date in your head. Give it a unit (day, week, month, quarter, year), a count, and whether to include the current in-progress period; it returns { start, end } as 'YYYY-MM-DD' bounds plus the list of months the window covers. Use it for phrases like 'the last 3 months', 'the past 90 days', or 'year to date'. A specific named period such as June 2026 or 2026-Q2 you filter directly, without this.",
      params: RESOLVE_DATES_PARAMS,
      handler(params) {
        state.handledCalls++
        const args = {
          unit: params.unit,
          count: params.count,
          includeCurrent: params.includeCurrent
        }
        const result =
          state.handledCalls > MAX_TOOL_CALLS_PER_TURN
            ? { ok: false, error: overBudget }
            : resolveDateWindow(args, today)
        turn.settleCall({ name: 'resolve_dates', args, result }, callDurationMs())
        return result
      }
    })
  }
}

async function handleChat(
  id: number,
  history: ChatHistoryItem[],
  prompt: string,
  toolScope: ChatToolScope,
  currency: string | null
): Promise<ChatGenerationResult> {
  // register as the active generation before any await so an abortGenerate
  // that lands while the chat context is still being created isn't lost
  const controller = new AbortController()
  activeGeneration = controller
  try {
    const session = await ensureChatSession()
    if (controller.signal.aborted) return { parts: [], interrupted: true }
    refreshScopeViews(toolScope)
    // the whole prior conversation is replaced per turn (stateless worker: the
    // feature owns history in the DB), so switching conversations needs nothing
    session.setChatHistory(history)

    // the turn log is the single assembler of the reply (see turn-log.ts):
    // every mutation below reports the changed part as a chatPart patch, and
    // finish() yields the same parts for persistence
    const turn = createTurnLog((index, part) => post({ event: 'chatPart', id, index, part }))
    const state: ChatTurnState = { handledCalls: 0, lastQuery: null }
    // one local date for the whole turn, same 'YYYY-MM-DD' the prompt quotes
    const today = new Date().toLocaleDateString('en-CA')
    // wall-clock when the tool call being written opened; each handler reads the
    // span up to its own settle, so the chain of thought can total tool time
    let openedCallAt: number | null = null
    const functions = chatFunctions({
      turn,
      currency,
      state,
      today,
      callDurationMs: () => (openedCallAt === null ? 0 : Date.now() - openedCallAt)
    })

    // the chat wrapper routes the model's chain of thought into segments, so
    // prompt() resolves with the answer alone; each segment streams into its
    // own reasoning part, in generation order, so a turn that thinks, calls a
    // tool, then thinks again keeps both thoughts where they happened rather
    // than collapsing into one lump
    let segmentStart: number | null = null
    // handler invocations arrive in generation order under
    // maxParallelFunctionCalls: 1, so the first params chunk of each callIndex
    // opens the pending card its handler then settles
    let openedCallIndex: number | null = null
    // stopOnAbortSignal makes an abort return the text generated so far
    // instead of throwing, so a stopped reply still reaches the DB
    const text = await session.prompt(prompt, {
      signal: controller.signal,
      stopOnAbortSignal: true,
      functions,
      // one call at a time keeps the params stream, handler invocations, and
      // the transcript's card order trivially aligned
      maxParallelFunctionCalls: 1,
      onFunctionCallParamsChunk: (chunk) => {
        if (chunk.callIndex !== openedCallIndex) {
          openedCallIndex = chunk.callIndex
          openedCallAt = Date.now()
          turn.openCall(chunk.functionName)
        }
      },
      onResponseChunk: (chunk) => {
        if (chunk.type === 'segment') {
          if (chunk.segmentStartTime) segmentStart = chunk.segmentStartTime.getTime()
          if (chunk.text) turn.reasoningChunk(chunk.text)
          if (chunk.segmentEndTime && segmentStart !== null) {
            turn.closeReasoning(chunk.segmentEndTime.getTime() - segmentStart)
            segmentStart = null
          }
        } else if (chunk.text) {
          turn.pushText(chunk.text)
        }
      }
    })
    // an abort mid-thought leaves the segment open; close it timed until now,
    // so a stopped turn still persists that thought
    if (segmentStart !== null) turn.closeReasoning(Date.now() - segmentStart)
    return turn.finish(text, controller.signal.aborted)
  } finally {
    if (activeGeneration === controller) activeGeneration = null
  }
}

async function dispatch(command: WorkerCommand): Promise<unknown> {
  switch (command.type) {
    case 'download':
      return handleDownload(command.modelId)
    case 'cancelDownload':
      return handleCancelDownload(command.modelId)
    case 'delete':
      return handleDelete(command.modelId)
    case 'load':
      return handleLoad(command.modelId)
    case 'unload':
      return handleUnload()
    case 'generate':
      return handleGenerate(command.prompt, command.schema)
    case 'abortGenerate':
      return handleAbortGenerate()
    case 'chat':
      return handleChat(
        command.id,
        command.history,
        command.prompt,
        command.toolScope,
        command.currency
      )
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
