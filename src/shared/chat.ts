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

// messages store an array of parts, so tool calls are a variant here, not a
// schema migration. Assistant messages may lead with a reasoning part (the
// model's chain of thought), then tool calls in order, then the answer text.
// The functionCall shape mirrors AI SDK tool parts (name/args/result) so a
// future provider migration stays mechanical.
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; durationMs: number }
  | { type: 'functionCall'; name: string; args: { sql: string }; result: QueryToolResult }

/** which stream a chat chunk belongs to: the visible answer or the chain of thought */
export type ChatChunkKind = 'text' | 'reasoning'

export type ChatRole = 'user' | 'assistant'
/** 'streaming' = the placeholder row of a reply still being generated */
export type ChatMessageStatus = 'streaming' | 'complete' | 'interrupted' | 'error'

export interface ChatMessage {
  id: number
  conversationId: number
  role: ChatRole
  parts: ChatMessagePart[]
  status: ChatMessageStatus
  /** present only when status is 'error' */
  errorMessage: string | null
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

/** The message's reasoning part, or null if the model didn't think out loud. */
export function messageReasoning(
  message: Pick<ChatMessage, 'parts'>
): Extract<ChatMessagePart, { type: 'reasoning' }> | null {
  return (
    message.parts.find(
      (p): p is Extract<ChatMessagePart, { type: 'reasoning' }> => p.type === 'reasoning'
    ) ?? null
  )
}

/**
 * Best-effort extraction of the sql value from a partial params JSON stream
 * (`{"sql": "SELECT …`) for live display while the model writes a tool call.
 * The exact SQL replaces it once the call starts executing, so this only has
 * to look right mid-stream, not parse perfectly.
 */
export function sqlFromParamsText(paramsText: string): string {
  const opening = /"sql"\s*:\s*"/.exec(paramsText)
  if (!opening) return ''
  let body = paramsText.slice(opening.index + opening[0].length)
  // drop the params object's closing quote/brace once generated; while the
  // stream is mid-escape, drop the dangling backslash too
  body = body.replace(/(?<!\\)"\s*\}?\s*$/, '')
  if (/(?<!\\)\\$/.test(body)) body = body.slice(0, -1)
  return body.replace(/\\(["\\/nrt])/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c
  )
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

/** streamed text since the last chunk event (main throttles to ~50ms batches) */
export interface ChatChunkEvent {
  conversationId: number
  text: string
  kind: ChatChunkKind
}

/** the assistant row is finalized (complete, interrupted, or errored) */
export interface ChatMessageDoneEvent {
  conversationId: number
  message: ChatMessage
}

/**
 * Lifecycle of one in-flight `query` tool call, keyed by callId within the
 * streaming reply: params chunks stream the argument text as the model writes
 * it, start marks execution with the parsed SQL, end carries the full
 * (already size-capped) result.
 */
export type ChatToolCallEvent =
  | { conversationId: number; callId: number; phase: 'params'; chunk: string }
  | { conversationId: number; callId: number; phase: 'start'; sql: string }
  | { conversationId: number; callId: number; phase: 'end'; result: QueryToolResult }

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
  restoreConversation: 'chat:restoreConversation',
  setConversationAccount: 'chat:setConversationAccount',
  listMessages: 'chat:listMessages',
  send: 'chat:send',
  stop: 'chat:stop',
  // main → renderer push events
  chunk: 'chat:chunk',
  messageDone: 'chat:messageDone',
  toolCall: 'chat:toolCall'
} as const
