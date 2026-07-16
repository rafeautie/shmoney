import { z } from 'zod'

// Chat with the local model: multiple conversations, each a persisted message
// history. Sending with a null conversationId creates the conversation
// implicitly on first message (no empty-conversation rows). Assistant replies
// stream to the renderer as chunk push events and are persisted on settle —
// including the partial text of a stopped generation.

// ---------- message parts ----------

// messages store an array of parts so the planned function-calling follow-up
// (functionCall/functionResult parts rendered inline) is a new variant here,
// not a schema migration. Assistant messages may lead with a reasoning part
// (the model's chain of thought) followed by the text of the answer.
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; durationMs: number }
  | { type: 'functionCall'; name: string; args: unknown; result?: unknown }

/** which stream a chat chunk belongs to: the visible answer or the chain of thought */
export type ChatChunkKind = 'text' | 'reasoning'

export type ChatRole = 'user' | 'assistant'
export type ChatMessageStatus = 'complete' | 'interrupted' | 'error'

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

// ---------- IPC inputs ----------

export const sendChatSchema = z.object({
  /** null = create a conversation for this first message */
  conversationId: z.number().int().positive().nullable(),
  text: z.string().trim().min(1).max(8000)
})
export type SendChatInput = z.infer<typeof sendChatSchema>

export const conversationIdSchema = z.number().int().positive()

export const renameConversationSchema = z.object({
  id: conversationIdSchema,
  title: z.string().trim().min(1).max(200)
})
export type RenameConversationInput = z.infer<typeof renameConversationSchema>

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

/** resolved by chat:send once the turn is accepted; the reply then streams */
export interface SendChatResult {
  conversation: Conversation
  userMessage: ChatMessage
}

// ---------- IPC ----------

export const CHAT_IPC = {
  listConversations: 'chat:listConversations',
  renameConversation: 'chat:renameConversation',
  deleteConversation: 'chat:deleteConversation',
  restoreConversation: 'chat:restoreConversation',
  listMessages: 'chat:listMessages',
  send: 'chat:send',
  stop: 'chat:stop',
  // main → renderer push events
  chunk: 'chat:chunk',
  messageDone: 'chat:messageDone'
} as const
