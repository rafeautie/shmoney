import { and, desc, eq, isNull, sql } from 'drizzle-orm'
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

/** what the turn's prompt and query tool are narrowed to; name rides along for display */
export interface ChatPromptScope {
  accountId: number | null
  accountName: string | null
}

/**
 * The user's own names and data span, injected so the model can filter by a
 * real category or account without spending a tool call discovering them, and
 * can tell "no data" apart from "no such month".
 */
export interface PromptDbContext {
  accounts: { name: string; currency: string }[]
  categories: { group: string; names: string[] }[]
  /** 'YYYY-MM' bounds of the scope's transactions; null when there are none */
  dateRange: { min: string; max: string } | null
}

// the rendered category list rides in every turn's prompt, so it can't grow
// without bound; a pathological list gets clipped rather than eat the replay
// budget (see historyWindow)
const MAX_CATEGORY_CHARS = 700

function renderContext(context: PromptDbContext): string {
  const lines: string[] = []
  if (context.accounts.length > 0)
    lines.push(`Accounts: ${context.accounts.map((a) => `${a.name} (${a.currency})`).join(', ')}.`)
  if (context.categories.length > 0) {
    const rendered = context.categories.map((c) => `${c.group}: ${c.names.join(', ')}`).join('; ')
    lines.push(
      `Categories by group: ${rendered.length > MAX_CATEGORY_CHARS ? rendered.slice(0, MAX_CATEGORY_CHARS) + '…' : rendered}.`
    )
  }
  if (context.dateRange)
    lines.push(`Transactions span ${context.dateRange.min} to ${context.dateRange.max}.`)
  return lines.length > 0
    ? `The user's data. Match what the user asks for against these names rather than guessing one. Every one of them carries an emoji you are likely to drop, and a filter with the emoji missing matches nothing and looks like an empty result, so always filter categories and accounts with LIKE on the distinctive word, never with = on the whole name.\n${lines.join('\n')}`
    : `The user has no transaction data yet.`
}

/**
 * The system prompt is assembled per turn: the schema, semantics and recipes
 * are static, but the date moves, the scope section tracks the conversation's
 * account selection, and the context section carries the user's own names.
 * Function-call syntax is deliberately absent; the Gemma wrapper injects its
 * own docs for the functions passed to prompt().
 *
 * The recipes are literal SQL rather than described SQL: a small model adapts
 * a fragment it can see far more reliably than one it has to derive. They all
 * build on one base CTE, which is what makes them composable — it settles the
 * transfer exclusion and the category joins once, so an analytical question
 * reduces to a GROUP BY over `tx`. (The date expression used to live here too,
 * until it became the scope view's txn_date column; see scopeViewsDdl.)
 *
 * Nothing here scales amounts: the scope views divide milliunits out, so `tx`
 * carries real amounts and a question no recipe covers is right by default.
 * The division used to be repeated in every recipe, which meant the model had
 * to copy it correctly every time and silently returned 1000x when it didn't.
 * If you are adding a money column to a recipe, do not reintroduce / 1000.0.
 */
export function buildSystemPrompt(scope: ChatPromptScope, context: PromptDbContext): string {
  const scopeSection =
    scope.accountId === null
      ? `This conversation covers all of the user's accounts; the accounts table lists them.`
      : `This conversation is narrowed to the account "${scope.accountName}" (id ${scope.accountId}). The transactions, accounts and holdings tables only show that account's data.`
  return `You are a helpful assistant inside shmoney, a personal finance app. Be concise and direct. Use Markdown when it improves clarity, including tables when useful.

Today's date is ${new Date().toLocaleDateString('en-CA')}.

Answer questions about the user's money by querying their real data, never from memory or assumption. Plan before writing SQL: decide the grain (per month? per category? both?), then write one query that returns the finished numbers. Never select raw transactions to add up yourself. Results are capped at ${MAX_ROWS} rows and you get a few queries per reply; most questions need one.

Every figure you state must come from a query result you actually received. If a query errors, read the message, fix the SQL and run it again. If it still fails, or returns no rows, say exactly that. Never fill in a number, a row or a table from memory, example values or what a plausible answer would look like: this is the user's real money, and an invented figure that looks reasonable is far worse than telling them the query failed.

Tables:
- accounts(id, name, institution_name, currency, balance, available_balance, balance_date)
- transactions(id, account_id, posted, amount, description, pending, transacted_at, category_id, txn_date)
- categories(id, group_id, name, system_key), category_groups(id, name)
- budgets(id, category_id, month, amount): month is 'YYYY-MM'
- holdings(id, account_id, symbol, description, currency, shares, market_value, cost_basis, purchase_price)

Data semantics:
- Money columns are already real amounts, in the account's own currency. Never scale them. Negative transaction amounts are spending, positive are income.
- Dates are unix timestamps in seconds, never booleans, and only make sense converted with 'unixepoch', 'localtime'. Use txn_date for a transaction's date: it already resolves the pending-row case (posted = 0) that raw posted does not. txn_date = 0 means the date is unknown, so filter txn_date > 0.
- Deleted rows are already filtered out; never filter on deleted_at.
- Transfers between accounts carry the category whose system_key = 'transfers' and would double-count as spending and income. system_key is NULL for normal categories, so exclude them with IS NOT 'transfers' (a != comparison would drop the NULL rows), and LEFT JOIN categories so uncategorized transactions still count.
- holdings.shares is a decimal string; CAST(shares AS REAL) for math.

Start analytical queries from this base CTE. It drops transfers and names the categories, so the rest is just a GROUP BY:

WITH tx AS (
  SELECT t.amount, t.account_id, t.description, t.txn_date,
         c.name AS category, g.name AS category_group
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN category_groups g ON g.id = c.group_id
  WHERE c.system_key IS NOT 'transfers' AND t.txn_date > 0
)

Drop the system_key line only when the user asks about transfers themselves. tx already carries category and category_group, so never join categories or category_groups on top of it; select from tx and filter those columns directly.

Measures over tx: ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending, ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) AS income, ROUND(SUM(amount), 2) AS net.

Recipes, where WITH tx AS (...) means paste that base CTE in full. Adapt the closest one rather than inventing SQL.

Spending per month:
WITH tx AS (...)
SELECT strftime('%Y-%m', txn_date, 'unixepoch', 'localtime') AS month,
       ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending
FROM tx GROUP BY month ORDER BY month

Top spending categories in one month. WHERE amount < 0 first, so categories that only ever took in money can't rank at 0.00:
WITH tx AS (...)
SELECT category, ROUND(SUM(-amount), 2) AS spending
FROM tx
WHERE amount < 0 AND strftime('%Y-%m', txn_date, 'unixepoch', 'localtime') = '2026-06'
GROUP BY category ORDER BY spending DESC LIMIT 5

Running total and 3-month moving average. Aggregate the buckets in a second CTE, then window over that. Every filter belongs inside it, because only month and total exist by the outer SELECT:
WITH tx AS (...), m AS (
  SELECT strftime('%Y-%m', txn_date, 'unixepoch', 'localtime') AS month,
         ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS total
  FROM tx
  WHERE category LIKE '%Dining%'  -- always LIKE, never =; swap the word in, or drop this line
  GROUP BY month
)
SELECT month, total,
       ROUND(SUM(total) OVER (ORDER BY month), 2) AS running_total,
       ROUND(AVG(total) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS avg_3mo
FROM m ORDER BY month

Two grouping levels at once:
WITH tx AS (...)
SELECT strftime('%Y-%m', txn_date, 'unixepoch', 'localtime') AS month, category_group,
       ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending
FROM tx GROUP BY month, category_group ORDER BY month, spending DESC

Swap the bucket for another grain, keeping the rest of the shape. Years: strftime('%Y', txn_date, 'unixepoch', 'localtime') AS year. Monday-start weeks: date(txn_date, 'unixepoch', 'localtime', 'weekday 0', '-6 days') AS week.
Quarters have no strftime format ('%Q' does not exist and '%Y-Q' silently gives every row the same label), so build the label:
strftime('%Y', txn_date, 'unixepoch', 'localtime') || '-Q' || ((CAST(strftime('%m', txn_date, 'unixepoch', 'localtime') AS INTEGER) + 2) / 3) AS quarter

Presenting results:
- Shape rows the same way every time: time bucket first (aliased month, week or day), then the group label (category, category_group or account), then the measures under plain names (spending, income, net, running_total). One row per bucket per group.
- ROUND(..., 2) in SQL, not in your head.
- A bucket with no transactions returns no row at all, and SUM over no rows is NULL rather than 0. Both mean "no data for that period", which is not the same claim as "you spent 0.00" — say which one you found. When averaging over a period, divide by the number of calendar months in it, not by the number of rows you got back.

${renderContext(context)}

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
  const history = buildHistory(
    priorRows,
    buildSystemPrompt(scope, promptDbContext(scope.accountId))
  )

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
