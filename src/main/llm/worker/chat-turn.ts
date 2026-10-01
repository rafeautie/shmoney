// One chat turn: the tools it exposes, the history it replays, and the reply
// it streams back as part patches.
import {
  defineChatSessionFunction,
  LlamaChatSession,
  type ChatWrapper,
  type ChatSessionModelFunctions,
  type GbnfJsonObjectSchema,
  type LlamaContextSequence,
  type Tokenizer
} from 'node-llama-cpp'
import { CONTEXT_SIZE, type GenerationStopReason, type ModelId } from '@shared/llm'
import {
  ACTION_TOOL_NAMES,
  ANALYSIS_TOOL_NAMES,
  type AnalysisToolName,
  type AnalysisToolResult,
  type ChartSpec,
  type ChartToolResult,
  type QueryToolResult
} from '@shared/chat'
import { currentTurnStart, fitHistory, shiftHistory, type MeasureTokens } from '../context-fit'
import type { ChatCommand, ChatGenerationResult, ChatSeedCall } from '../protocol'
import { createTurnLog, type TurnLog } from '../turn-log'
import type { UsageMeter } from '../usage-meter'
import {
  MAX_ROWS,
  MAX_TOOL_CALLS_PER_TURN,
  partialMonthNote,
  partialMonths
} from '../tools/sql-tool'
import {
  CHART_FUNCTION_PARAMS,
  chartCallNote,
  prepareChart,
  type PreparedChart
} from '../tools/chart-tool'
import { CALC_FUNCTION_PARAMS, evaluateExpression } from '../tools/calc-tool'
import {
  ANALYSIS_RUNNERS,
  actionToolSchemas,
  analysisToolSchemas,
  modelView,
  runAction,
  type AnalysisContext,
  type ProposalOutput,
  type ToolOutput
} from '../tools/analysis'
import { meterFor, stopReasonOf } from './metering'
import { post, postFinalStats } from './port'
import { ensureToolDb, refreshScopeViews, runQuery } from './tool-db'

// the in-flight turn, read by the session's context-shift strategy (fixed at
// session creation): its tools, so their docs count like LlamaChat counts them,
// and how many older history items the model still sees after any shift, so
// the truncation marker lands where the model's view actually ended
let shiftTurn: { functions: ChatSessionModelFunctions; olderKept: number } | null = null

// room kept free for the reply (thoughts, tool calls and their results) when
// cutting the replayed history; the shift strategy covers a reply that outgrows it
const CHAT_REPLY_RESERVE = Math.floor(CONTEXT_SIZE / 4)

function measureTokens(
  chatWrapper: ChatWrapper,
  tokenizer: Tokenizer,
  functions: ChatSessionModelFunctions | undefined
): MeasureTokens {
  return (chatHistory) =>
    chatWrapper
      .generateContextState({ chatHistory, availableFunctions: functions })
      .contextText.tokenize(tokenizer).length
}

// live chat stats are snapshots; a few a second is plenty for a ticking readout
const STATS_INTERVAL_MS = 250

/** the chat session; its context-shift strategy reads the in-flight turn */
export function createChatSession(
  sequence: LlamaContextSequence,
  chatWrapper: ChatWrapper
): LlamaChatSession {
  const { tokenizer } = sequence.model
  return new LlamaChatSession({
    contextSequence: sequence,
    chatWrapper,
    contextShift: {
      strategy: ({ chatHistory, maxTokensCount, chatWrapper }) => {
        const shifted = shiftHistory(
          chatHistory,
          measureTokens(chatWrapper, tokenizer, shiftTurn?.functions),
          maxTokensCount
        )
        if (shiftTurn)
          shiftTurn.olderKept = Math.min(shiftTurn.olderKept, currentTurnStart(shifted) - 1)
        return { chatHistory: shifted }
      }
    }
  })
}

// the mutable call bookkeeping the turn's tool handlers share
interface ChatTurnState {
  // counts handler invocations to enforce the per-turn tool budget
  handledCalls: number
  // what the chart tool draws from: charts always visualize the most recent
  // successful data result, so no result-id plumbing is needed. A turn starts
  // with the previous turn's last result rerun here (see seedLastResult), so
  // "show that as a pie" has something to draw.
  lastQuery: QueryToolResult | null
  // the chart the typed tool behind lastQuery suggested; a restyle keeps its
  // columns and swaps the type
  lastChart: ChartSpec | null
  // 'YYYY-MM' labels of the months at the data's edges that aren't whole
  partialMonths: string[]
  // an action tool proposed a change: the turn only summarizes from here on
  proposed: boolean
}

/** a typed result as the chart tool's source, when it has rows to draw */
function asQueryResult(result: AnalysisToolResult): QueryToolResult | null {
  if (!result.ok || !result.columns?.length || !result.rows?.length) return null
  return {
    ok: true,
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
    durationMs: result.durationMs
  }
}

/**
 * Rerun the previous turn's last data call so this turn's chart tool and the
 * model's follow-ups ("now just groceries", "as a pie") start from fresh rows.
 * Silent: it adds no part, and a failure just leaves nothing to draw.
 */
function seedLastResult(
  seed: ChatSeedCall | null,
  analysis: AnalysisContext,
  state: ChatTurnState
): void {
  if (!seed) return
  // the seed replays from persisted history every turn, so a throw here would
  // fail every later turn of the conversation, not just this one
  try {
    if (seed.name === 'query') {
      const result = runQuery(String(seed.args.sql ?? ''))
      if (result.ok) {
        state.lastQuery = result
        state.lastChart = seed.chart
      }
      return
    }
    const run = ANALYSIS_RUNNERS[seed.name as AnalysisToolName]
    if (!run) return
    const output = run(seed.args, analysis)
    state.lastQuery = asQueryResult(output.result)
    state.lastChart = state.lastQuery ? (seed.chart ?? output.chart) : null
  } catch (err) {
    console.warn(`chat seed rerun failed: ${String((err as Error)?.message ?? err)}`)
  }
}

/** a runner's output, or its exception as an ok:false result the model can read */
function guarded<T>(run: () => T, failed: (error: string) => T): T {
  try {
    return run()
  } catch (err) {
    return failed(`The tool failed: ${String((err as Error)?.message ?? err)}`)
  }
}

/**
 * The tools a chat turn exposes. Handlers report through the turn log alone —
 * it is the single assembler, and its part patches are the stream — so events
 * and persisted parts carry the same shapes by construction, chart currency
 * included. The typed tools answer the common questions with finished
 * figures; query is the fallback for anything they don't cover, with calc for
 * arithmetic on its rows. Action tools only propose: the user applies.
 */
function chatFunctions(ctx: {
  turn: TurnLog
  currency: string | null
  state: ChatTurnState
  analysis: AnalysisContext
  // the current call's open-to-settle wall-clock, read at settle time
  callDurationMs: () => number
}): ChatSessionModelFunctions {
  const { turn, currency, state, analysis, callDurationMs } = ctx
  const overBudget =
    'The tool budget for this reply is used up; answer with the data you already have.'
  const afterProposal =
    'A change is already proposed for the user to apply; answer in one sentence without calling more tools.'
  // why a call can't run, or null when it can; counts the call either way
  const blocked = (): string | null => {
    state.handledCalls++
    if (state.proposed) return afterProposal
    return state.handledCalls > MAX_TOOL_CALLS_PER_TURN ? overBudget : null
  }

  /** draw a chart as its own part, the same shape a chart call settles as */
  const drawChart = (spec: ChartSpec): PreparedChart => {
    const prepared = prepareChart(spec, state.lastQuery)
    turn.settleCall(
      {
        name: 'chart',
        args: spec,
        result: prepared.ok ? { ok: true } : { ok: false, error: prepared.error },
        display: prepared.ok ? { data: prepared.data, currency, series: prepared.series } : null
      },
      0
    )
    return prepared
  }

  const functions: Record<string, ChatSessionModelFunctions[string]> = {}
  const analysisSchemas = analysisToolSchemas(analysis.vocab)
  for (const name of ANALYSIS_TOOL_NAMES) {
    const schema = analysisSchemas[name]
    functions[name] = defineChatSessionFunction({
      description: schema.description,
      params: schema.params as GbnfJsonObjectSchema,
      handler(params) {
        const args = { ...(params as Record<string, unknown>) }
        const reason = blocked()
        const failed = (error: string): ToolOutput => ({
          result: { ok: false, error, durationMs: 0 },
          chart: null
        })
        const output = reason
          ? failed(reason)
          : guarded(() => ANALYSIS_RUNNERS[name](args, analysis), failed)
        turn.settleCall({ name, args, result: output.result }, callDurationMs())
        const source = asQueryResult(output.result)
        // an empty result replaces the last one too, so a chart can't draw
        // stale rows under an answer about something else
        if (output.result.ok) {
          state.lastQuery = source
          state.lastChart = source ? output.chart : null
        }
        // the loop draws the tool's own chart, so the model never names columns
        // for a typed result; its note steers the prose away from the rows
        const drawn = output.chart !== null && source !== null && drawChart(output.chart).ok
        return drawn
          ? {
              ...modelView(output.result),
              note: 'A chart of these rows is shown with your answer. Give the takeaway in a sentence or two; do not list the rows.'
            }
          : modelView(output.result)
      }
    })
  }

  const actionSchemas = actionToolSchemas(analysis.vocab)
  for (const name of ACTION_TOOL_NAMES) {
    const schema = actionSchemas[name]
    functions[name] = defineChatSessionFunction({
      description: schema.description,
      params: schema.params as GbnfJsonObjectSchema,
      handler(params) {
        const args = { ...(params as Record<string, unknown>) }
        const reason = blocked()
        const failed = (error: string): ProposalOutput => ({
          result: { ok: false, error },
          display: null
        })
        const output = reason
          ? failed(reason)
          : guarded(() => runAction(name, args, analysis), failed)
        if (output.result.ok) state.proposed = true
        turn.settleCall(
          { name, args, result: output.result, display: output.display },
          callDurationMs()
        )
        return output.result
      }
    })
  }

  functions.query = defineChatSessionFunction({
    description: `Run one read-only SQLite SELECT over the finance data, only when none of the other tools can answer. CTEs and window functions are supported. Aggregate in SQL and alias columns clearly; results are capped at ${MAX_ROWS} rows.`,
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
      const reason = blocked()
      const result = reason ? { ok: false, error: reason, durationMs: 0 } : runQuery(sql)
      if (result.ok) {
        state.lastQuery = result
        state.lastChart = null
      }
      turn.settleCall({ name: 'query', args: { sql }, result }, callDurationMs())
      // Append chartCallNote last, where a chart call is about to be
      // written: the exact legal column names, plus the group recipe when
      // the result is unambiguously long-form. A rule adjacent to the
      // generation point beats the same rule in the system prompt, and this
      // one carries the model's OWN aliases and result shape, which no system
      // prompt can. In-turn only; replayed calls carry a bare result.
      if (!result.ok || !result.columns?.length || !result.rows?.length) return result
      const partial = partialMonthNote(result.rows, state.partialMonths)
      const note = chartCallNote(result.columns, result.rows)
      return { ...result, note: partial ? `${partial} ${note}` : note }
    }
  })

  functions.chart = defineChatSessionFunction({
    description:
      "Show a chart of your latest query result, or restyle the chart already shown ('show that as a pie', 'as bars'). The other tools draw their own charts, so never call this right after them. Every name in x, group and series must appear verbatim in that result's columns array; for a restyle, set x and series to null and give only the new type and title.",
    params: CHART_FUNCTION_PARAMS,
    handler(params) {
      const reason = blocked()
      // null columns restyle the chart the last typed result drew
      const base = params.x === null || params.series === null ? state.lastChart : null
      const spec: ChartSpec = {
        type: params.type,
        title: params.title,
        x: params.x ?? base?.x ?? '',
        series: params.series ? [...params.series] : (base?.series ?? []),
        group: params.x === null ? (base?.group ?? null) : params.group
      }
      // prepareChart owns the whole spec-to-drawable step (including the
      // group pivot), so its data is the single source of what renders;
      // the model still only ever sees the tiny ok/error result
      const prepared: PreparedChart = reason
        ? { ok: false, error: reason }
        : spec.x === '' || spec.series.length === 0
          ? {
              ok: false,
              error: 'There is no chart to restyle yet; name x and series from your result.'
            }
          : prepareChart(spec, state.lastQuery)
      // what a later "show that as a pie" restyles
      if (prepared.ok) state.lastChart = spec
      const result: ChartToolResult = prepared.ok
        ? { ok: true }
        : { ok: false, error: prepared.error }
      const display = prepared.ok
        ? { data: prepared.data, currency, series: prepared.series }
        : null
      turn.settleCall({ name: 'chart', args: spec, result, display }, callDurationMs())
      // steer the follow-up prose from the result itself; instructions this
      // close to where the model writes next land far more reliably on a small
      // model than the same words back in the system prompt. In-turn only:
      // replayed chart calls carry a bare ok.
      return result.ok
        ? {
            ...result,
            note: 'The chart is now displayed. Give the takeaway in a sentence or two; do not repeat the charted rows as a table.'
          }
        : result
    }
  })

  functions.calc = defineChatSessionFunction({
    description:
      'Evaluate one arithmetic expression and get the exact number back, for combining figures from query results: a percentage, a difference, a ratio. The other tools already return finished figures, so it is rarely needed after them. Write the actual numbers into the expression. Supports + - * / ** and parentheses.',
    params: CALC_FUNCTION_PARAMS,
    handler({ expression }) {
      const reason = blocked()
      const result = reason ? { ok: false, error: reason } : evaluateExpression(expression)
      turn.settleCall({ name: 'calc', args: { expression }, result }, callDurationMs())
      return result
    }
  })

  return functions
}

/** generation stops while a handler runs; time it as tool time, not decode */
function meteredFunctions(
  functions: ChatSessionModelFunctions,
  usage: UsageMeter
): ChatSessionModelFunctions {
  return Object.fromEntries(
    Object.entries(functions).map(([name, fn]) => [
      name,
      {
        ...fn,
        async handler(params: unknown) {
          usage.pause()
          const started = Date.now()
          try {
            return await fn.handler(params as never)
          } finally {
            usage.addToolMs(Date.now() - started)
          }
        }
      }
    ])
  )
}

export async function runChatTurn(
  command: ChatCommand,
  session: LlamaChatSession,
  modelId: ModelId,
  signal: AbortSignal
): Promise<ChatGenerationResult> {
  const { id, history, prompt, toolScope, currency, goalRows, tools } = command
  let meter: UsageMeter | null = null
  let stopReason: GenerationStopReason = 'error'
  try {
    refreshScopeViews(toolScope, goalRows)

    // the turn log is the single assembler of the reply (see turn-log.ts):
    // every mutation below reports the changed part as a chatPart patch, and
    // finish() yields the same parts for persistence
    const turn = createTurnLog((index, part) => post({ event: 'chatPart', id, index, part }))
    // one local date for the whole turn, same 'YYYY-MM-DD' the prompt quotes
    const today = new Date().toLocaleDateString('en-CA')
    const db = ensureToolDb()
    const span = db.prepare('SELECT MIN(txn_date) AS min, MAX(txn_date) AS max FROM tx').get() as {
      min: string | null
      max: string | null
    }
    const state: ChatTurnState = {
      handledCalls: 0,
      lastQuery: null,
      lastChart: null,
      partialMonths: partialMonths(span.min, today),
      proposed: false
    }
    const analysis: AnalysisContext = {
      db,
      today,
      data: span.min && span.max ? { min: span.min, max: span.max } : null,
      vocab: tools.vocab,
      goalPace: tools.goalPace
    }
    seedLastResult(tools.seed, analysis, state)
    // wall-clock when the tool call being written opened; each handler reads the
    // span up to its own settle, so the chain of thought can total tool time
    let openedCallAt: number | null = null
    const usage = meterFor(session, modelId)
    meter = usage
    const functions = meteredFunctions(
      chatFunctions({
        turn,
        currency,
        state,
        analysis,
        callDurationMs: () => (openedCallAt === null ? 0 : Date.now() - openedCallAt)
      }),
      usage
    )
    let statsPostedAt = 0
    const sample = (): void => {
      usage.sample()
      const now = Date.now()
      if (now - statsPostedAt < STATS_INTERVAL_MS) return
      statsPostedAt = now
      post({ event: 'stats', id, stats: usage.snapshot(), final: false })
    }

    // the whole prior conversation is replaced per turn (stateless worker: the
    // feature owns history in the DB), so switching conversations needs nothing.
    // Main sends every replayable turn; the cut happens here, in real tokens.
    const historyDropped = fitHistory(
      history,
      prompt,
      measureTokens(session.chatWrapper, session.model.tokenizer, functions),
      CONTEXT_SIZE - CHAT_REPLY_RESERVE
    )
    session.setChatHistory([history[0], ...history.slice(1 + historyDropped)])
    shiftTurn = { functions, olderKept: history.length - 1 - historyDropped }
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
    const { responseText: text, stopReason: libraryStop } = await session.promptWithMeta(prompt, {
      signal,
      stopOnAbortSignal: true,
      functions,
      // one call at a time keeps the params stream, handler invocations, and
      // the transcript's card order trivially aligned
      maxParallelFunctionCalls: 1,
      onFunctionCallParamsChunk: (chunk) => {
        sample()
        if (chunk.callIndex !== openedCallIndex) {
          openedCallIndex = chunk.callIndex
          openedCallAt = Date.now()
          turn.openCall(chunk.functionName)
        }
      },
      onResponseChunk: (chunk) => {
        sample()
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
    stopReason = stopReasonOf(libraryStop)
    return {
      ...turn.finish(text, signal.aborted),
      historyDropped: history.length - 1 - shiftTurn.olderKept
    }
  } catch (err) {
    if (signal.aborted) stopReason = 'aborted'
    throw err
  } finally {
    shiftTurn = null
    if (meter) postFinalStats(id, meter.finish(stopReason))
  }
}
