import { desc, eq, isNull } from 'drizzle-orm'
import type { ChatHistoryItem } from 'node-llama-cpp'
import { CHAT_CONTEXT_SIZE, LLM_MODEL } from '@shared/llm'
import {
  CHAT_IPC,
  messageText,
  type ChatMessage,
  type Conversation,
  type SendChatInput,
  type SendChatResult
} from '@shared/chat'
import { db } from '../../db'
import {
  chatMessages,
  conversations,
  type ChatMessageRow,
  type ConversationRow
} from '../../db/schema'
import { createLogger } from '../../logging'
import { llmManager, sendToRenderer } from '../manager'
import { enqueueGenerate } from '../queue'

const log = createLogger('llm')

// history is trimmed to leave the model room to answer: rough 4-chars-per-token
// estimate, capped well under the chat context so the reply fits; the worker's
// contextShift is the backstop when the estimate is off
const HISTORY_TOKEN_BUDGET = Math.floor(CHAT_CONTEXT_SIZE * 0.75)
const CHARS_PER_TOKEN = 4

const SYSTEM_PROMPT =
  'You are a helpful assistant inside shmoney, a personal finance app. ' +
  'Be concise and direct. Use Markdown when it improves clarity, including tables when useful.'

// the one in-flight turn; chat is single-flight by design (the model serializes
// on one queue anyway, and a second concurrent turn would interleave chunks)
let activeChat: { conversationId: number; controller: AbortController } | null = null

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    modelLabel: row.modelLabel
  }
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    parts: row.parts,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt
  }
}

export function listConversations(): Conversation[] {
  // soft-deleted rows are excluded here and restored by restoreConversation
  return db
    .select()
    .from(conversations)
    .where(isNull(conversations.deletedAt))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .all()
    .map(rowToConversation)
}

export function listMessages(conversationId: number): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.id)
    .all()
    .map(rowToMessage)
}

/** first line of the first user message, clipped, as the automatic title */
function titleFrom(text: string): string {
  const line = text.split('\n', 1)[0].trim()
  return line.length > 60 ? line.slice(0, 57) + '…' : line
}

/**
 * Map persisted rows to the model's history, newest-first trimmed to the token
 * budget. Interrupted partials stay (the user saw them); error rows carry no
 * assistant text worth replaying and are skipped.
 */
function buildHistory(rows: ChatMessageRow[]): ChatHistoryItem[] {
  const items: ChatHistoryItem[] = []
  let chars = 0
  const budget = HISTORY_TOKEN_BUDGET * CHARS_PER_TOKEN
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row.status === 'error') continue
    const text = messageText(row)
    if (!text) continue
    if (chars + text.length > budget) break
    chars += text.length
    items.unshift(
      row.role === 'user' ? { type: 'user', text } : { type: 'model', response: [text] }
    )
  }
  return [{ type: 'system', text: SYSTEM_PROMPT }, ...items]
}

/**
 * Accept one chat turn: persist the user message (creating the conversation on
 * a null id), then stream the reply in the background — chunk push events while
 * it runs, a messageDone push with the persisted assistant row when it settles
 * (complete, interrupted with partial text, or errored). Resolves as soon as
 * the turn is accepted so the UI can navigate/render immediately.
 */
export async function sendChatMessage(input: SendChatInput): Promise<SendChatResult> {
  if (activeChat) throw new Error('A chat reply is already being generated')
  const { stage } = llmManager.getStatus()
  if (stage !== 'ready' && stage !== 'downloaded') throw new Error(`Model is not ready (${stage})`)

  const now = Date.now()
  let conversationRow: ConversationRow
  if (input.conversationId === null) {
    conversationRow = db
      .insert(conversations)
      .values({
        title: titleFrom(input.text),
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        modelLabel: LLM_MODEL.label
      })
      .returning()
      .get()
  } else {
    const row = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .get()
    if (!row || row.deletedAt !== null) throw new Error('Conversation not found')
    conversationRow = row
  }

  const priorRows = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationRow.id))
    .orderBy(chatMessages.id)
    .all()

  const userRow = db
    .insert(chatMessages)
    .values({
      conversationId: conversationRow.id,
      role: 'user',
      parts: [{ type: 'text', text: input.text }],
      status: 'complete',
      createdAt: now
    })
    .returning()
    .get()
  db.update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationRow.id))
    .run()

  const controller = new AbortController()
  activeChat = { conversationId: conversationRow.id, controller }
  const history = buildHistory(priorRows)

  // the reply generates in the background; its lifecycle reaches the renderer
  // through push events, and the settled row is persisted either way
  void enqueueGenerate(() =>
    llmManager.chat(history, input.text, {
      signal: controller.signal,
      onChunk: (text) =>
        sendToRenderer(CHAT_IPC.chunk, { conversationId: conversationRow.id, text })
    })
  )
    .then((result) => finishTurn(conversationRow.id, result.text, result.interrupted, null))
    .catch((err) => {
      // a stop before the turn ever reached the model (still queued behind
      // another generation) rejects instead of resolving interrupted; that's
      // a stop, not a failure
      if (controller.signal.aborted) return finishTurn(conversationRow.id, '', true, null)
      // logged serialized, never raw: the error chain can drag the prompt
      // along, and prompts carry the user's private conversation text
      log.error('chat.generation-failed', err)
      return finishTurn(conversationRow.id, '', false, String((err as Error)?.message ?? err))
    })
    .finally(() => {
      if (activeChat?.controller === controller) activeChat = null
    })

  return { conversation: rowToConversation(conversationRow), userMessage: rowToMessage(userRow) }
}

function finishTurn(
  conversationId: number,
  text: string,
  interrupted: boolean,
  errorMessage: string | null
): void {
  const now = Date.now()
  const row = db
    .insert(chatMessages)
    .values({
      conversationId,
      role: 'assistant',
      parts: [{ type: 'text', text }],
      status: errorMessage !== null ? 'error' : interrupted ? 'interrupted' : 'complete',
      errorMessage,
      createdAt: now
    })
    .returning()
    .get()
  db.update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run()
  sendToRenderer(CHAT_IPC.messageDone, { conversationId, message: rowToMessage(row) })
}

/** Abort the in-flight reply; its partial text still lands via messageDone. */
export function stopChat(): void {
  activeChat?.controller.abort(new Error('Generation cancelled'))
}
