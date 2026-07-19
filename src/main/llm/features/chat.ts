import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { ChatHistoryItem, ChatModelResponse } from 'node-llama-cpp'
import { CHAT_CONTEXT_SIZE, LLM_MODEL } from '@shared/llm'
import {
  CHAT_IPC,
  type ChatMessage,
  type ChatMessagePart,
  type Conversation,
  type ConversationMessages,
  type SendChatInput,
  type SendChatResult
} from '@shared/chat'
import type { ChatGenerationResult } from '../protocol'
import { resolveCurrency } from '../chart-tool'
import { buildSystemPrompt, type ChatPromptScope, type PromptDbContext } from '../system-prompt'
import { db } from '../../db'
import {
  accounts,
  categories,
  categoryGroups,
  chatMessages,
  conversations,
  transactions,
  type ConversationRow
} from '../../db/schema'
import { transactionDate } from '../../ipc/transactions-page'
import { createLogger } from '../../logging'
import { llmManager, sendToRenderer } from '../manager'
import { enqueueGenerate } from '../queue'

const log = createLogger('llm')

// history is trimmed to leave the model room to answer: rough 4-chars-per-token
// estimate, capped well under the chat context so the reply fits; the worker's
// contextShift is the backstop when the estimate is off
const HISTORY_TOKEN_BUDGET = Math.floor(CHAT_CONTEXT_SIZE * 0.75)
const CHARS_PER_TOKEN = 4

// the prompt and its types live in ../system-prompt (which carries the
// prompt-design notes); re-exported so existing importers of this module keep
// working
export { buildSystemPrompt }
export type { ChatPromptScope, PromptDbContext } from '../system-prompt'

/** first line of the first user message, clipped, as the automatic title */
export function titleFrom(text: string): string {
  const line = text.split('\n', 1)[0].trim()
  return line.length > 60 ? line.slice(0, 57) + '…' : line
}

/** a tool call as it replays into history */
interface ReplayCall {
  name: string
  params: object
  result: object
}

/** one replayed piece of an assistant turn, in the order it was generated */
type ReplayItem = { kind: 'text'; text: string } | { kind: 'call'; call: ReplayCall }

/**
 * The result a replayed call carries back to the model. Chart results are
 * already tiny; a successful query result is rewritten — rows and columns
 * dropped, an expiry note in their place — because the chart tool only draws
 * from a query run in the current reply, and replaying stale rows convinced
 * the model it had something to chart. The note plants the corrective move
 * (re-run the query) exactly where the model reads. Failed results replay
 * as-is: their error strings are already small and instructive.
 */
function replayResult(part: Extract<ChatMessagePart, { type: 'functionCall' }>): object {
  if (part.name !== 'query' || !part.result.ok) return part.result
  return {
    ok: true,
    rowCount: part.result.rowCount,
    note: 'Expired; to reuse or chart this data, run the query again in the current reply.'
  }
}

/**
 * What a row contributes to replayed history, in part order; null = skipped
 * entirely. Error rows carry no assistant content worth replaying. Reasoning
 * parts are never replayed: a past turn's chain of thought is display
 * material, not conversation. Tool calls ARE replayed — interleaved with the
 * text around them, so the model re-sees the turn as it generated it — and a
 * turn stopped mid-query (calls but no text yet) is kept for the same reason.
 * Every tool call replays uniformly — its args and result, never its display
 * payload — which is structural rather than a per-tool convention: display
 * simply isn't in this projection, so a chart's snapshotted rows never reach
 * the model on replay, only its spec and bare outcome. Successful query
 * results are likewise slimmed on replay (see replayResult): the chart tool
 * can only draw from a query run in the current reply, and replaying stale
 * rows taught the model the opposite.
 */
function replayable(row: Pick<ChatMessage, 'role' | 'status' | 'parts'>): ReplayItem[] | null {
  if (row.status === 'error') return null
  const items = row.parts.flatMap((p): ReplayItem[] => {
    if (p.type === 'text') return p.text.trim() ? [{ kind: 'text', text: p.text }] : []
    if (p.type === 'functionCall')
      return [{ kind: 'call', call: { name: p.name, params: p.args, result: replayResult(p) } }]
    return []
  })
  return items.length > 0 ? items : null
}

function replayCost(items: ReplayItem[]): number {
  return items.reduce(
    (n, item) => n + (item.kind === 'text' ? item.text.length : JSON.stringify(item.call).length),
    0
  )
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
    const cost = replayCost(replay)
    if (chars + cost > budget) return { start, truncated: true }
    chars += cost
    start = i
  }
  return { start, truncated: false }
}

/**
 * Map persisted rows to the model's history: the historyWindow slice (also
 * what the UI's truncation marker reflects), with interrupted partials kept
 * (the user saw them) and tool calls as native functionCall entries in their
 * generated position among the text.
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
      items.push({
        type: 'user',
        text: replay
          .filter((item): item is Extract<ReplayItem, { kind: 'text' }> => item.kind === 'text')
          .map((item) => item.text)
          .join('')
      })
    } else {
      const response: ChatModelResponse['response'] = replay.map((item) =>
        item.kind === 'text'
          ? item.text
          : {
              type: 'functionCall' as const,
              name: item.call.name,
              params: item.call.params,
              result: item.call.result
            }
      )
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

/**
 * The names and data span the prompt quotes back to the model, read fresh per
 * turn and narrowed the same way the tool's scope views are, so the prompt
 * never mentions data the query tool can't see.
 */
function promptDbContext(accountId: number | null): PromptDbContext {
  const accountRows = db
    .select({ name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(accountId === null ? undefined : eq(accounts.id, accountId))
    .orderBy(accounts.name)
    .all()

  // categories are never account-scoped, matching the tool's views
  const categoryRows = db
    .select({ group: categoryGroups.name, name: categories.name })
    .from(categories)
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .orderBy(categories.name)
    .all()
  const byGroup = new Map<string, string[]>()
  for (const row of categoryRows) {
    // ungrouped categories are real and worth naming; they just have no header
    const group = row.group ?? 'Ungrouped'
    const names = byGroup.get(group)
    if (names) names.push(row.name)
    else byGroup.set(group, [row.name])
  }
  const grouped = [...byGroup].map(([group, names]) => ({ group, names }))
  grouped.sort((a, b) =>
    a.group === 'Ungrouped' ? 1 : b.group === 'Ungrouped' ? -1 : a.group.localeCompare(b.group)
  )

  const range = db
    .select({
      min: sql<string | null>`strftime('%Y-%m', min(${transactionDate}), 'unixepoch', 'localtime')`,
      max: sql<string | null>`strftime('%Y-%m', max(${transactionDate}), 'unixepoch', 'localtime')`
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        sql`${transactionDate} > 0`,
        accountId === null ? undefined : eq(transactions.accountId, accountId)
      )
    )
    .get()

  return {
    accounts: accountRows,
    categories: grouped,
    dateRange: range?.min && range.max ? { min: range.min, max: range.max } : null
  }
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
  // soft-deleted rows are excluded here and restored by undoing the delete (action log)
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
  const { start, truncated } = historyWindow(
    rows,
    buildSystemPrompt(scope, promptDbContext(scope.accountId))
  )
  // ChatMessageRow is structurally a ChatMessage; no mapping needed
  return {
    messages: rows,
    truncatedBeforeId: truncated ? (rows[start]?.id ?? null) : null
  }
}

/** the send's target conversation: created on a null id, loaded otherwise */
function getOrCreateConversation(input: SendChatInput, now: number): ConversationRow {
  if (input.conversationId === null) {
    if (input.accountId !== null && accountScope(input.accountId).accountId === null)
      throw new Error('Account not found')
    return db
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
  }
  const row = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .get()
  if (!row || row.deletedAt !== null) throw new Error('Conversation not found')
  return row
}

/** bump the conversation's recency stamps (list ordering) after a message lands */
function touchConversation(id: number, now: number): void {
  db.update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, id))
    .run()
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
  const conversationRow = getOrCreateConversation(input, now)
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
      // recorded per turn: the conversation's scope is editable, so the row
      // keeps what this reply actually ran under
      scope: { accountId: scope.accountId, accountName: scope.accountName },
      createdAt: now
    })
    .returning()
    .get()
  touchConversation(conversationRow.id, now)

  const controller = new AbortController()
  activeChat = controller
  const context = promptDbContext(scope.accountId)
  const history = buildHistory(priorRows, buildSystemPrompt(scope, context))
  launchGeneration({
    conversationId: conversationRow.id,
    assistantMessageId: assistantRow.id,
    history,
    prompt: input.text,
    scope,
    // the currency chart values format as, fixed per turn alongside the
    // prompt context it derives from; the worker stamps it at the source
    currency: resolveCurrency(context.accounts),
    controller
  })

  return {
    conversation: rowToConversation(conversationRow),
    userMessage: userRow,
    assistantMessage: assistantRow
  }
}

/**
 * Generate the reply in the background: its lifecycle reaches the renderer
 * through push events, and the settled row is persisted either way. Part
 * patches forward verbatim; the worker's turn log already built them in
 * their final shape, chart currency included.
 */
function launchGeneration(turn: {
  conversationId: number
  assistantMessageId: number
  history: ChatHistoryItem[]
  prompt: string
  scope: ChatPromptScope
  currency: string | null
  controller: AbortController
}): void {
  const { conversationId, assistantMessageId, controller } = turn
  void enqueueGenerate(() =>
    llmManager.chat(turn.history, turn.prompt, {
      signal: controller.signal,
      toolScope: { accountId: turn.scope.accountId },
      currency: turn.currency,
      onPart: (index, part) => sendToRenderer(CHAT_IPC.part, { conversationId, index, part })
    })
  )
    .then((result) => finishTurn(assistantMessageId, result, null))
    .catch((err) => {
      // a stop before the turn ever reached the model (still queued behind
      // another generation) rejects instead of resolving interrupted; that's
      // a stop, not a failure
      if (controller.signal.aborted)
        return finishTurn(assistantMessageId, { parts: [], interrupted: true }, null)
      // logged serialized, never raw: the error chain can drag the prompt
      // along, and prompts carry the user's private conversation text
      log.error('chat.generation-failed', err)
      return finishTurn(
        assistantMessageId,
        { parts: [], interrupted: false },
        String((err as Error)?.message ?? err)
      )
    })
    .finally(() => {
      if (activeChat === controller) activeChat = null
    })
}

/**
 * Settle the assistant row with the worker's result: the parts arrive already
 * in their persisted format, built in generation order at the source (see
 * turn-log.ts), so they are written verbatim.
 */
function finishTurn(
  assistantMessageId: number,
  result: ChatGenerationResult,
  errorMessage: string | null
): void {
  const { interrupted } = result
  const now = Date.now()
  // the placeholder row can't vanish mid-turn: conversation deletes are soft,
  // and the purge of soft-deleted rows only runs at startup before any turn
  // can start, so no missing-row guard is needed here
  const row = db
    .update(chatMessages)
    .set({
      parts: result.parts,
      status: errorMessage !== null ? 'error' : interrupted ? 'interrupted' : 'complete',
      errorMessage
    })
    .where(eq(chatMessages.id, assistantMessageId))
    .returning()
    .get()
  touchConversation(row.conversationId, now)
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

/**
 * Soft-deleted conversations from a prior session had their undo toast close
 * with the app, so there's no restoring them; runs once at startup, before
 * the renderer exists, and hard-deletes those rows for good. Same-session
 * deletes stay restorable since this never runs mid-session. Messages go via
 * the FK cascade.
 */
export function purgeDeletedConversations(): void {
  db.delete(conversations).where(isNotNull(conversations.deletedAt)).run()
}

/** Abort the in-flight reply; its partial text still lands via messageDone. */
export function stopChat(): void {
  activeChat?.abort(new Error('Generation cancelled'))
}
