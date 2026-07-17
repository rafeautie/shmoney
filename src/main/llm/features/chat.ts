import { desc, eq, isNull } from 'drizzle-orm'
import type { ChatHistoryItem, ChatModelResponse } from 'node-llama-cpp'
import { CHAT_CONTEXT_SIZE, LLM_MODEL } from '@shared/llm'
import {
  CHAT_IPC,
  messageText,
  type ChatMessage,
  type ChatMessagePart,
  type Conversation,
  type ConversationMessages,
  type SendChatInput,
  type SendChatResult
} from '@shared/chat'
import type { ChatGenerationResult } from '../protocol'
import { MAX_ROWS } from '../sql-tool'
import { db } from '../../db'
import { accounts, chatMessages, conversations, type ConversationRow } from '../../db/schema'
import { createLogger } from '../../logging'
import { llmManager, sendToRenderer } from '../manager'
import { enqueueGenerate } from '../queue'

const log = createLogger('llm')

// history is trimmed to leave the model room to answer: rough 4-chars-per-token
// estimate, capped well under the chat context so the reply fits; the worker's
// contextShift is the backstop when the estimate is off
const HISTORY_TOKEN_BUDGET = Math.floor(CHAT_CONTEXT_SIZE * 0.75)
const CHARS_PER_TOKEN = 4

/** what the turn's prompt and query tool are narrowed to; name rides along for display */
export interface ChatPromptScope {
  accountId: number | null
  accountName: string | null
}

/**
 * The system prompt is assembled per turn: the schema and semantics are
 * static, but the date moves and the scope section tracks the conversation's
 * account selection. Function-call syntax is deliberately absent; the Gemma
 * wrapper injects its own docs for the functions passed to prompt().
 */
export function buildSystemPrompt(scope: ChatPromptScope): string {
  const scopeSection =
    scope.accountId === null
      ? `This conversation covers all of the user's accounts; the accounts table lists them.`
      : `This conversation is narrowed to the account "${scope.accountName}" (id ${scope.accountId}). The transactions, accounts and holdings tables only show that account's data.`
  return `You are a helpful assistant inside shmoney, a personal finance app. Be concise and direct. Use Markdown when it improves clarity, including tables when useful.

Today's date is ${new Date().toLocaleDateString('en-CA')}.

You can call the query function to answer questions from the user's real finance data. Prefer a few small aggregated queries over selecting many raw rows; results are capped at ${MAX_ROWS} rows and oversized results are truncated. Keep queries simple.

Tables:
- accounts(id, name, institution_name, currency, balance, available_balance, balance_date, invert_balance)
- transactions(id, account_id, posted, amount, description, pending, transacted_at, category_id)
- categories(id, group_id, name, system_key), category_groups(id, name)
- budgets(id, category_id, month, amount): month is 'YYYY-MM'
- holdings(id, account_id, symbol, description, currency, shares, market_value, cost_basis, purchase_price)

Data semantics:
- Money columns are integer milliunits: divide by 1000.0 for the real amount. Negative transaction amounts are spending, positive are income.
- posted and balance_date are unix timestamps in seconds, never booleans. Pending transactions can have posted = 0, so a transaction's date is COALESCE(NULLIF(posted, 0), transacted_at). Always convert with 'unixepoch': to filter one month use strftime('%Y-%m', COALESCE(NULLIF(posted, 0), transacted_at), 'unixepoch', 'localtime') = '2026-06'.
- Deleted rows are already filtered out; never filter on deleted_at.
- Transfers between accounts carry the category whose system_key = 'transfers'; exclude them from spending and income analysis. system_key is NULL for normal categories, so filter with system_key IS NOT 'transfers' (a != comparison would drop NULL rows), and LEFT JOIN categories so uncategorized transactions still count.
- If accounts.invert_balance is 1, the displayed balance is -balance.
- holdings.shares is a decimal string; CAST(shares AS REAL) for math.

${scopeSection}`
}

/** first line of the first user message, clipped, as the automatic title */
export function titleFrom(text: string): string {
  const line = text.split('\n', 1)[0].trim()
  return line.length > 60 ? line.slice(0, 57) + '…' : line
}

/**
 * What a row contributes to replayed history; null = skipped entirely. Error
 * rows carry no assistant content worth replaying. Reasoning parts are never
 * replayed: a past turn's chain of thought is display material, not
 * conversation. Query calls ARE replayed so the model remembers what data it
 * already fetched; a turn stopped mid-query (calls but no text yet) is kept
 * for the same reason.
 */
function replayable(row: Pick<ChatMessage, 'role' | 'status' | 'parts'>): {
  text: string
  calls: Extract<ChatMessagePart, { type: 'functionCall' }>[]
} | null {
  if (row.status === 'error') return null
  const text = messageText(row)
  const calls = row.parts.filter(
    (p): p is Extract<ChatMessagePart, { type: 'functionCall' }> => p.type === 'functionCall'
  )
  if (!text && calls.length === 0) return null
  return { text, calls }
}

/**
 * Where the replay budget (shrunk by the system prompt, which shares the
 * context) cuts the conversation, walking newest-first: start is the index of
 * the oldest row the model still sees. truncated is true only when an older
 * row was dropped for the budget, not merely skipped as unreplayable, and the
 * cut is gapless: everything before start is dropped, even rows that would fit.
 */
export function historyWindow(
  rows: Pick<ChatMessage, 'role' | 'status' | 'parts'>[],
  systemPrompt: string
): { start: number; truncated: boolean } {
  let chars = 0
  let start = rows.length
  const budget = HISTORY_TOKEN_BUDGET * CHARS_PER_TOKEN - systemPrompt.length
  for (let i = rows.length - 1; i >= 0; i--) {
    const replay = replayable(rows[i])
    if (!replay) continue
    const cost = replay.text.length + replay.calls.reduce((n, c) => n + JSON.stringify(c).length, 0)
    if (chars + cost > budget) return { start, truncated: true }
    chars += cost
    start = i
  }
  return { start, truncated: false }
}

/**
 * Map persisted rows to the model's history: the historyWindow slice (also
 * what the UI's truncation marker reflects), with interrupted partials kept
 * (the user saw them) and query calls as native functionCall entries ahead of
 * the answer text.
 */
export function buildHistory(
  rows: Pick<ChatMessage, 'role' | 'status' | 'parts'>[],
  systemPrompt: string
): ChatHistoryItem[] {
  const items: ChatHistoryItem[] = []
  for (let i = historyWindow(rows, systemPrompt).start; i < rows.length; i++) {
    const replay = replayable(rows[i])
    if (!replay) continue
    if (rows[i].role === 'user') {
      items.push({ type: 'user', text: replay.text })
    } else {
      const response: ChatModelResponse['response'] = replay.calls.map((c) => ({
        type: 'functionCall' as const,
        name: c.name,
        params: c.args,
        result: c.result
      }))
      if (replay.text) response.push(replay.text)
      items.push({ type: 'model', response })
    }
  }
  return [{ type: 'system', text: systemPrompt }, ...items]
}

// the one in-flight turn's abort controller; chat is single-flight by design
// (the model serializes on one queue anyway, and a second concurrent turn
// would interleave chunks)
let activeChat: AbortController | null = null

/**
 * Resolve an account id into the turn's scope. A null id, or an account that
 * has since been deleted, widens to all accounts.
 */
function accountScope(accountId: number | null): ChatPromptScope {
  const account =
    accountId === null
      ? undefined
      : db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .get()
  return { accountId: account?.id ?? null, accountName: account?.name ?? null }
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    modelLabel: row.modelLabel,
    accountId: row.accountId
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

/**
 * A conversation's rows plus where the next turn's replay window starts, so
 * the UI can mark the cut. The window is computed exactly as the next send
 * will: these same rows as prior history under the scope's system prompt.
 */
export function listMessages(conversationId: number): ConversationMessages {
  const rows = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.id)
    .all()
  const conversation = db
    .select({ accountId: conversations.accountId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get()
  const scope = accountScope(conversation?.accountId ?? null)
  const { start, truncated } = historyWindow(rows, buildSystemPrompt(scope))
  // ChatMessageRow is structurally a ChatMessage; no mapping needed
  return {
    messages: rows,
    truncatedBeforeId: truncated ? (rows[start]?.id ?? null) : null
  }
}

/**
 * Accept one chat turn: persist the user message and a placeholder assistant
 * row (creating the conversation on a null id), then stream the reply in the
 * background — chunk push events while it runs, a messageDone push with the
 * finalized assistant row when it settles (complete, interrupted with partial
 * text, or errored). Resolves as soon as the turn is accepted so the UI can
 * navigate/render immediately.
 */
export async function sendChatMessage(input: SendChatInput): Promise<SendChatResult> {
  if (activeChat) throw new Error('A chat reply is already being generated')
  const { stage } = llmManager.getStatus()
  if (stage !== 'ready' && stage !== 'downloaded') throw new Error(`Model is not ready (${stage})`)

  const now = Date.now()
  let conversationRow: ConversationRow
  if (input.conversationId === null) {
    if (input.accountId !== null && accountScope(input.accountId).accountId === null)
      throw new Error('Account not found')
    conversationRow = db
      .insert(conversations)
      .values({
        title: titleFrom(input.text),
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        modelLabel: LLM_MODEL.label,
        accountId: input.accountId
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
  // a scoped conversation whose account has since vanished falls back to all
  // accounts, consistently for both the prompt and the tool's scope views
  const scope = accountScope(conversationRow.accountId)

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
  // the reply's row exists from the start so the UI renders the whole turn
  // with stable identities; finishTurn fills it in when the turn settles
  const assistantRow = db
    .insert(chatMessages)
    .values({
      conversationId: conversationRow.id,
      role: 'assistant',
      parts: [],
      status: 'streaming',
      createdAt: now
    })
    .returning()
    .get()
  db.update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationRow.id))
    .run()

  const controller = new AbortController()
  activeChat = controller
  const history = buildHistory(priorRows, buildSystemPrompt(scope))

  // the reply generates in the background; its lifecycle reaches the renderer
  // through push events, and the settled row is persisted either way
  void enqueueGenerate(() =>
    llmManager.chat(history, input.text, {
      signal: controller.signal,
      onChunk: (text, kind) =>
        sendToRenderer(CHAT_IPC.chunk, { conversationId: conversationRow.id, text, kind }),
      toolScope: { accountId: scope.accountId },
      onToolEvent: (event) =>
        sendToRenderer(CHAT_IPC.toolCall, { conversationId: conversationRow.id, ...event })
    })
  )
    .then((result) => finishTurn(assistantRow.id, result, null))
    .catch((err) => {
      const empty = { text: '', reasoning: '', reasoningMs: 0, functionCalls: [] }
      // a stop before the turn ever reached the model (still queued behind
      // another generation) rejects instead of resolving interrupted; that's
      // a stop, not a failure
      if (controller.signal.aborted)
        return finishTurn(assistantRow.id, { ...empty, interrupted: true }, null)
      // logged serialized, never raw: the error chain can drag the prompt
      // along, and prompts carry the user's private conversation text
      log.error('chat.generation-failed', err)
      return finishTurn(
        assistantRow.id,
        { ...empty, interrupted: false },
        String((err as Error)?.message ?? err)
      )
    })
    .finally(() => {
      if (activeChat === controller) activeChat = null
    })

  return {
    conversation: rowToConversation(conversationRow),
    userMessage: userRow,
    assistantMessage: assistantRow
  }
}

/**
 * Persisted part order mirrors generation: chain of thought, then the query
 * calls in the order the model made them, then the answer. (Prose the model
 * interleaves between calls is flattened into the one text part.)
 */
export function assembleAssistantParts(result: ChatGenerationResult): ChatMessagePart[] {
  const parts: ChatMessagePart[] = []
  if (result.reasoning)
    parts.push({ type: 'reasoning', text: result.reasoning, durationMs: result.reasoningMs })
  for (const call of result.functionCalls)
    parts.push({ type: 'functionCall', name: call.name, args: call.args, result: call.result })
  parts.push({ type: 'text', text: result.text })
  return parts
}

function finishTurn(
  assistantMessageId: number,
  result: ChatGenerationResult,
  errorMessage: string | null
): void {
  const { interrupted } = result
  const now = Date.now()
  // the placeholder row can't vanish mid-turn: conversation deletes are soft,
  // so nothing cascades into chat_messages while a reply is generating (a
  // future hard-delete/purge path would need a missing-row guard here)
  const row = db
    .update(chatMessages)
    .set({
      parts: assembleAssistantParts(result),
      status: errorMessage !== null ? 'error' : interrupted ? 'interrupted' : 'complete',
      errorMessage
    })
    .where(eq(chatMessages.id, assistantMessageId))
    .returning()
    .get()
  db.update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, row.conversationId))
    .run()
  sendToRenderer(CHAT_IPC.messageDone, {
    conversationId: row.conversationId,
    message: row
  })
}

/**
 * Rows left 'streaming' by a crash mid-turn settle as interrupted; runs once
 * at startup, before the renderer can list messages.
 */
export function recoverAbandonedTurns(): void {
  db.update(chatMessages)
    .set({ status: 'interrupted' })
    .where(eq(chatMessages.status, 'streaming'))
    .run()
}

/** Abort the in-flight reply; its partial text still lands via messageDone. */
export function stopChat(): void {
  activeChat?.abort(new Error('Generation cancelled'))
}
