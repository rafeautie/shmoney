import { z } from 'zod'

// Chat with the local model: multiple conversations, each a persisted message
// history. Sending with a null conversationId creates the conversation
// implicitly on first message (no empty-conversation rows). Accepting a turn
// persists the user message and a placeholder assistant row (status
// 'streaming'); chunks stream to the renderer as push events, and the row is
// finalized in place on settle — including the partial text of a stopped
// generation. The stable row identity means the UI never swaps a streaming
// element for a persisted one.

// ---------- message parts ----------

/**
 * Outcome of one `query` tool call. This exact object is also what the model
 * receives as the function result, so error strings are phrased for the model.
 * Rows are arrays (not objects) to keep replayed history token-cheap.
 */
export interface QueryToolResult {
  ok: boolean
  columns?: string[]
  rows?: unknown[][]
  /** rows returned after the row cap was applied */
  rowCount?: number
  /** true when the row or character cap dropped data */
  truncated?: boolean
  /** present when ok is false */
  error?: string
  durationMs: number
}

// ---------- charts ----------

/** chart types the chart tool may emit; kept small so the model picks correctly */
export const CHART_TYPES = ['line', 'bar', 'pie', 'stat'] as const
export type ChartType = (typeof CHART_TYPES)[number]

/**
 * A declarative chart over the columns of a query result. The model composes
 * this (decoding is grammar-constrained to the shape, so it's structurally
 * valid by construction); the app validates the column references and owns
 * rendering. x and series name columns of the turn's most recent successful
 * query result.
 */
export interface ChartSpec {
  type: ChartType
  /** short human title shown above the chart */
  title: string
  /**
   * label/x-axis column. Always generated (every param is required under the
   * grammar) but ignored for stat, which has no axis.
   */
  x: string
  /** numeric value columns; pie uses only the first, stat shows the first plus an optional second as a signed change */
  series: string[]
  /**
   * For a long-form result (one row per x per group): the column whose values
   * become the series — the model's natural GROUP BY column, stated instead
   * of guessed. null when the result already has one column per series.
   * Requires exactly one series entry: the measure to plot per group.
   * Undefined only on parts persisted before the field existed.
   */
  group: string | null
}

/** the charted rows, snapshotted from the source query result so history renders stably without re-querying */
export interface ChartData {
  columns: string[]
  rows: unknown[][]
}

/**
 * What the model receives back from a chart call. Deliberately tiny — the
 * charted data rides on events and parts, never back through the model — so a
 * replayed chart call costs a few tokens. Error strings are phrased for the
 * model.
 */
export interface ChartToolResult {
  ok: boolean
  /** present when ok is false */
  error?: string
}

/**
 * Everything a chart needs to draw that the model has no business seeing: the
 * snapshotted rows (so history renders stably without re-querying) and the
 * currency to format them in (the scope's single currency, or null to format
 * values as plain numbers).
 */
export interface ChartDisplay {
  data: ChartData
  currency: string | null
  /**
   * The series labels to draw, resolved by the main process. They match
   * spec.series for a direct draw and are the group values after a pivot.
   * Parts persisted before the pivot existed lack the field in their JSON;
   * the settled render path fills it from spec.series in one place.
   */
  series: string[]
}

// ---------- calc & dates ----------

/**
 * Outcome of one `calc` tool call: the evaluated number, or an error phrased
 * for the model. Like every tool result this is also what the model receives
 * back, so it stays tiny.
 */
export interface CalcToolResult {
  ok: boolean
  /** present when ok is true */
  value?: number
  /** present when ok is false */
  error?: string
}

/** what the `resolve_dates` tool resolves a relative period into */
export type DateUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Outcome of one `resolve_dates` tool call: concrete bounds the model then
 * filters on. start/end are inclusive 'YYYY-MM-DD' bounds for txn_date, and
 * months lists every 'YYYY-MM' the window touches (for the month/quarter/year
 * grain columns). Error strings are phrased for the model.
 */
export interface DateWindowToolResult {
  ok: boolean
  /** inclusive lower bound, 'YYYY-MM-DD' */
  start?: string
  /** inclusive upper bound, 'YYYY-MM-DD' */
  end?: string
  /** every calendar month the window spans, as 'YYYY-MM' */
  months?: string[]
  /** present when ok is false */
  error?: string
}

/**
 * One settled tool call, discriminated by tool name. args and result are
 * exactly what crossed the model boundary, and are the only fields that replay
 * into history; display is render payload the model never sees. Keeping that
 * split structural is why every tool shares this one shape.
 */
export type ChatToolCall =
  | { name: 'query'; args: { sql: string }; result: QueryToolResult }
  // display is null when the call failed validation: there is nothing to draw,
  // and result.error carries the message (displayed, like a failed query,
  // rather than silently dropped).
  | { name: 'chart'; args: ChartSpec; result: ChartToolResult; display: ChartDisplay | null }
  // calc and resolve_dates never draw anything, so they carry no display: their
  // whole output is the small result the model reads back and states.
  | { name: 'calc'; args: { expression: string }; result: CalcToolResult }
  | {
      name: 'resolve_dates'
      args: { unit: DateUnit; count: number; includeCurrent: boolean }
      result: DateWindowToolResult
    }

// messages store an array of parts, so tool calls are a variant here, not a
// schema migration. Every part sits in generation order, reasoning included:
// text the model wrote before a call (its preamble) precedes that call's
// part, and a turn that thinks, calls a tool, then thinks again keeps both
// thoughts where they happened. The UI renders parts strictly in this order,
// AI-Elements style, with no part held back. The
// functionCall shape mirrors AI SDK tool parts (name/args/result) so a future
// provider migration stays mechanical.
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; durationMs: number }
  // durationMs is the call's wall-clock span (the model writing its params plus
  // the tool running), so a turn's chain of thought can report how long its tool
  // calls took, not only its thinking. Parts persisted before the field existed
  // lack it; the renderer treats a missing span as zero.
  | ({ type: 'functionCall'; durationMs: number } & ChatToolCall)

/**
 * A part as it crosses the wire mid-turn: either the settled shape it will
 * persist as, or one of the two pending forms that settle in place — a thought
 * still being written (durationMs null), or a tool call whose params the model
 * is still writing (no args or result yet). One vocabulary for streaming and
 * persisted rendering; the renderer derives "active" from the pending form and
 * never assembles anything itself.
 */
export type StreamingChatPart =
  | ChatMessagePart
  | { type: 'reasoning'; text: string; durationMs: null }
  | { type: 'functionCall'; name: string; args?: undefined; result?: undefined }

export type ChatRole = 'user' | 'assistant'
/** 'streaming' = the placeholder row of a reply still being generated */
export type ChatMessageStatus = 'streaming' | 'complete' | 'interrupted' | 'error'

/**
 * The account scope a turn actually ran under, recorded at generation time —
 * the conversation's scope is editable mid-conversation, so without this a
 * transcript can mix answers from different scopes indistinguishably. The
 * name is captured as it was then, so the record survives renames/deletion.
 */
export interface ChatTurnScope {
  /** null = all accounts */
  accountId: number | null
  accountName: string | null
}

export interface ChatMessage {
  id: number
  conversationId: number
  role: ChatRole
  parts: ChatMessagePart[]
  status: ChatMessageStatus
  /** present only when status is 'error' */
  errorMessage: string | null
  /** assistant rows: the scope this turn ran under; null on user rows and pre-scope history */
  scope: ChatTurnScope | null
  /** unix milliseconds */
  createdAt: number
}

export interface Conversation {
  id: number
  /** null = untitled (no message sent yet) */
  title: string | null
  createdAt: number
  updatedAt: number
  /** ordering key for the list; null until the first message lands */
  lastMessageAt: number | null
  modelLabel: string
  /** account this chat is narrowed to; null = all accounts */
  accountId: number | null
}

/** Extract a message's displayable text (its text parts, joined). */
export function messageText(message: Pick<ChatMessage, 'parts'>): string {
  return message.parts
    .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

// ---------- IPC inputs ----------

export const sendChatSchema = z.object({
  /** null = create a conversation for this first message */
  conversationId: z.number().int().positive().nullable(),
  text: z.string().trim().min(1).max(8000),
  /** scope for a conversation created by this send; ignored when conversationId is set */
  accountId: z.number().int().positive().nullable().default(null)
})
export type SendChatInput = z.infer<typeof sendChatSchema>

export const conversationIdSchema = z.number().int().positive()

export const renameConversationSchema = z.object({
  id: conversationIdSchema,
  title: z.string().trim().min(1).max(200)
})
export type RenameConversationInput = z.infer<typeof renameConversationSchema>

export const setConversationAccountSchema = z.object({
  id: conversationIdSchema,
  /** null = widen back to all accounts */
  accountId: z.number().int().positive().nullable()
})
export type SetConversationAccountInput = z.infer<typeof setConversationAccountSchema>

// ---------- push event payloads ----------

/**
 * The one streaming event of an in-flight reply: the full current part at
 * `index` (main coalesces to ~50ms batches, latest patch per index). The
 * worker's TurnLog is the only assembler; the renderer just applies
 * `parts[index] = part` and renders. Chart display payloads ride on the
 * settled part exactly as they persist.
 */
export interface ChatPartEvent {
  conversationId: number
  index: number
  part: StreamingChatPart
}

/** the assistant row is finalized (complete, interrupted, or errored) */
export interface ChatMessageDoneEvent {
  conversationId: number
  message: ChatMessage
}

/** chat:listMessages payload: the rows plus where the model's replay window starts */
export interface ConversationMessages {
  messages: ChatMessage[]
  /**
   * id of the oldest message the model still sees; older ones no longer fit
   * its context. Null while the whole conversation fits (nothing truncated).
   */
  truncatedBeforeId: number | null
}

/** resolved by chat:send once the turn is accepted; the reply then streams */
export interface SendChatResult {
  conversation: Conversation
  userMessage: ChatMessage
  /** the placeholder row the reply streams into; messageDone carries its final form */
  assistantMessage: ChatMessage
}

// ---------- IPC ----------

export const CHAT_IPC = {
  listConversations: 'chat:listConversations',
  renameConversation: 'chat:renameConversation',
  deleteConversation: 'chat:deleteConversation',
  setConversationAccount: 'chat:setConversationAccount',
  listMessages: 'chat:listMessages',
  send: 'chat:send',
  stop: 'chat:stop',
  // main → renderer push events
  part: 'chat:part',
  messageDone: 'chat:messageDone'
} as const
