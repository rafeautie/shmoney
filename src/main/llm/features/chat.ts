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
import { MAX_CHART_SERIES, resolveCurrency } from '../chart-tool'
import { MAX_ROWS, MAX_TOOL_CALLS_PER_TURN } from '../sql-tool'
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
  // The recipes deliberately don't carry currency: for the single-currency user
  // (almost everyone) it would be a column of one repeated value in every
  // result, and clutter the model has to correctly drop. So the rule arrives
  // only for the users it applies to, as a recipe rather than a caution —
  // stated as a caution, every recipe the model copies still blends.
  if (new Set(context.accounts.map((a) => a.currency)).size > 1)
    lines.push(
      `These accounts do NOT share a currency, so adding their amounts together gives a meaningless number. Add currency as the FIRST grouping column of every query and never sum across it, including over the accounts table:\nSELECT currency, month, ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending\nFROM tx GROUP BY currency, month ORDER BY currency, month\nReport each currency's figure separately, and never convert between them: you have no exchange rate.`
    )
  if (context.categories.length > 0) {
    const rendered = context.categories.map((c) => `${c.group}: ${c.names.join(', ')}`).join('; ')
    lines.push(
      `Categories by group: ${rendered.length > MAX_CATEGORY_CHARS ? rendered.slice(0, MAX_CATEGORY_CHARS) + '…' : rendered}.`
    )
  }
  if (context.dateRange)
    lines.push(`Transactions span ${context.dateRange.min} to ${context.dateRange.max}.`)
  return lines.length > 0
    ? `The user's data. Match what the user asks for against these names rather than guessing one. Every one of them carries an emoji you are likely to drop, and a filter with the emoji missing matches nothing and looks like an empty result, so always filter categories and accounts with LIKE on the distinctive word, never with = on the whole name. Excluding one is the exception: category is NULL on uncategorized transactions, and NULL NOT LIKE anything is NULL, so write (category NOT LIKE '%Word%' OR category IS NULL) or those rows vanish from both sides.\n${lines.join('\n')}`
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
 * start FROM tx — a real scope view now (see scopeViewsDdl), not a CTE the
 * model pastes; it abbreviated the pasted CTE once, lost an alias, and
 * invented a column — which settles the transfer/pending/undated exclusions
 * once, so an analytical question reduces to a GROUP BY. Time buckets come
 * from the view's grain columns (month, quarter, year, week), so no recipe
 * teaches strftime beyond the one day-of-month overlay that has no column.
 *
 * Every SQL fragment below is executed against the real schema by
 * prompt-sql.test.ts, which also holds the recipes to the rules the model can
 * only infer from them (bare-identifier aliases, explicit window frames). Edit
 * a recipe and that suite re-runs the edit; add one and it fails until you
 * account for it. A recipe that doesn't run is worse than no recipe at all.
 *
 * Nothing here scales amounts: the scope views divide milliunits out, so tx
 * carries real amounts and a question no recipe covers is right by default.
 * If you are adding a money column to a recipe, do not reintroduce / 1000.0.
 */
export function buildSystemPrompt(scope: ChatPromptScope, context: PromptDbContext): string {
  const scopeSection =
    scope.accountId === null
      ? `This conversation covers all of the user's accounts; the accounts table lists them.`
      : `This conversation is narrowed to the account "${scope.accountName}" (id ${scope.accountId}). The transactions, accounts and holdings tables only show that account's data.`
  return `You are a helpful assistant inside shmoney, a personal finance app. Be concise and direct. Use Markdown when it improves clarity, including tables when useful.

Today's date is ${new Date().toLocaleDateString('en-CA')}.

Answer questions about the user's money by querying their real data, never from memory or assumption. Act on every request immediately: never ask permission to run a query or draw a chart, and never ask the user to confirm your plan — the request itself is the confirmation. If a request is ambiguous, pick the most reasonable reading, answer it, and note the assumption in one short clause. Plan before writing SQL: decide the grain (per month? per category? both?), then write one query that returns the finished numbers. Never select raw transactions to add up yourself. Results are capped at ${MAX_ROWS} rows and you get up to ${MAX_TOOL_CALLS_PER_TURN} tool calls per reply; most questions need one query.

Every figure you state must come from a query result you actually received. If a query errors, read the message, fix the SQL and run it again. If it still fails, or returns no rows, say exactly that. Never fill in a number, a row or a table from memory, example values or what a plausible answer would look like: this is the user's real money, and an invented figure that looks reasonable is far worse than telling them the query failed.

Tables:
- accounts(id, name, institution_name, currency, balance, available_balance, balance_date)
- transactions(id, account_id, account_name, posted, amount, description, pending, transacted_at, category_id, category, category_group, system_key, txn_date, month, quarter, year, week, currency)
- tx: transactions minus transfers, pending and undated rows. Start every spending, income or trend query FROM tx; query transactions directly only when asked about transfers or pending rows themselves.
- budgets(id, category_id, category, month, amount): month is 'YYYY-MM'
- holdings(id, account_id, symbol, description, currency, shares, market_value, cost_basis, purchase_price, created_at)
- connections(id, last_synced_at, created_at): the bank link; last_synced_at NULL means never synced
- rules(id, name, enabled, priority, conditions, action, created_at, updated_at): the user's auto-categorization rules; conditions and action are JSON
- action_log(id, created_at, source, label, undone_at): history of every change the app or user made; label is the human summary, undone_at is set once undone

Data semantics:
- Money columns are already real amounts, in the account's own currency. Never scale them. Negative transaction amounts are spending, positive are income. Every transaction carries its account's currency; when the accounts span more than one currency, never add their amounts together; group by currency or filter to one.
- Date columns are local-time text: txn_date is 'YYYY-MM-DD', other date columns are 'YYYY-MM-DD HH:MM:SS'. Compare them directly as strings; the epoch-to-text conversion already happened, so never add conversion modifiers to a date column. Use txn_date for a transaction's date: it already resolves the pending-row case that raw posted does not. txn_date IS NULL means the date is unknown, so filter txn_date IS NOT NULL.
- Time buckets are ready-made text columns: month 'YYYY-MM', quarter 'YYYY-Qn', year 'YYYY', week 'YYYY-Wnn'. Group and filter by them directly (month = '2026-06'), never BETWEEN a partial 'YYYY-MM' string against txn_date: that silently drops the end month. The non-transaction date columns carry a time, so an upper endpoint of 'YYYY-MM-DD' drops that whole last day; compare date(column) instead.
- A CTE hides every column it does not SELECT. Inside WITH ... AS (...) you can see all of tx, but the outer query sees ONLY that CTE's own SELECT list: the columns you filtered or grouped by inside it are gone unless you also selected them. So before writing the outer query, list the columns it names (the ones it selects, groups by, orders by, and the ORDER BY inside any window function) and put every one of them in the CTE's SELECT list, plus its GROUP BY when the CTE aggregates. "no such column: X" on a query with a WITH clause always means exactly this: add X to the inner SELECT and GROUP BY, then run it again.
- Deleted rows are already filtered out; never filter on deleted_at.
- Every transaction already carries its category name (category), group (category_group) and system_key; all three are NULL on uncategorized rows. Never join another table for a name.
- system_key = 'transfers' marks transfers between accounts, which would double-count as spending and income; tx already excludes them. Over transactions, exclude with IS NOT 'transfers', never != (which would also drop every NULL row); to see transfers themselves, filter system_key = 'transfers'.
- pending is 0 or 1. pending = 1 rows have not posted yet; tx keeps only pending = 0, so its totals match the app's Reports page.
- holdings.shares is a decimal string; CAST(shares AS REAL) for math.

Group by the label columns tx already carries: category, category_group, account_name. Group by account_name, never account_id: an id charts as an axis labelled 1, 2, 3.

Measures over tx: ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending, ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) AS income, ROUND(SUM(amount), 2) AS net.

Recipes. Adapt the closest one rather than inventing SQL.

Spending per month (swap month for quarter, year or week for another grain):
SELECT month, ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending
FROM tx GROUP BY month ORDER BY month

One account's balance ("what's my checking balance", "how much is in savings"). Every account name ends in a number you will not reproduce from memory, so = on the name you typed matches nothing and looks like a missing account; match the distinctive word with LIKE and let the query tell you the full name:
SELECT name, ROUND(balance, 2) AS balance
FROM accounts WHERE name LIKE '%Checking%'  -- swap in the distinctive word the user said; never = on the whole name
If it returns several accounts, list them; if it returns none, the word is wrong, so query SELECT name FROM accounts and match against what comes back rather than telling the user they have no such account.

Spending per day over a recent window ("last 30 days", "past week" — swap the offset):
SELECT txn_date AS day, ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending
FROM tx WHERE txn_date >= date('now', 'localtime', '-30 days')
GROUP BY day ORDER BY day

Average spending per month over a window ("average monthly spending", "how much do I typically spend a month"). Count the calendar months of the window yourself and type that count in as the divisor. A month with no transactions returns no row at all, so AVG() over monthly totals, or dividing by COUNT(*), divides by the months that HAVE data and overstates the average:
SELECT ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) / 6.0, 2) AS avg_monthly_spending
FROM tx WHERE month BETWEEN '2026-02' AND '2026-07'  -- placeholders: '2026-02' through '2026-07' is 6 months, hence 6.0; swap in the months asked about and count them
Both endpoints are whole 'YYYY-MM' values, so BETWEEN is safe on month (never on txn_date). For "all time", count the months from the span stated below. Write the divisor with a decimal point (6.0, not 6): integer division truncates and would report a whole number.

Top spending categories. WHERE amount < 0 first, so categories that only ever took in money can't rank at 0.00:
SELECT category, ROUND(SUM(-amount), 2) AS spending
FROM tx WHERE amount < 0 AND month = '2026-06'  -- '2026-06' is a placeholder: swap in the month asked about, or drop the month condition for all time
GROUP BY category ORDER BY spending DESC LIMIT 5

Running total and 3-month moving average. Aggregate the buckets in a CTE, then window over that. Every filter belongs inside it, because only month and total exist by the outer SELECT:
WITH m AS (
  SELECT month, ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS total
  FROM tx
  WHERE category LIKE '%Dining%'  -- always LIKE, never =; swap the word in, or drop this line
  GROUP BY month
)  -- month and total are all that exist below; see the CTE rule above
SELECT month, total,
       ROUND(SUM(total) OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS running_total,
       ROUND(AVG(total) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS avg_3mo
FROM m ORDER BY month
Both frames count ROWS, and a month with no transactions produces no row at all, so avg_3mo averages the last three months THAT HAVE DATA, which is not a calendar three-month average when the months you got back skip one. Check the months in the result before calling it one; the first two rows average fewer than three months in any case. Always spell the frame out as ROWS: without it, rows sharing an ORDER BY value silently all get the whole group's total.

One row per bucket per group ("per category per month", "one line per account", "for each category"). WHERE amount < 0 first, for the same reason as above:
SELECT month, category_group, ROUND(SUM(-amount), 2) AS spending
FROM tx WHERE amount < 0
GROUP BY month, category_group ORDER BY month, spending DESC
Swap category_group for category or account_name. Present it as a table, or chart it with group set to the group column (see the chart examples).

Compare two months day by day ("June vs July", "this month vs last month"): both months have to land on the SAME x value or the lines never overlap, and a date belongs to only one month, so bucket by day OF THE MONTH. month_total repeats each month's whole-month figure on every one of that month's rows, so the number you quote in the sentence is one you can read off:
SELECT CAST(strftime('%d', txn_date) AS INTEGER) AS day, month, ROUND(SUM(-amount), 2) AS spending,
       ROUND(SUM(SUM(-amount)) OVER (PARTITION BY month ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING), 2) AS month_total
FROM tx WHERE amount < 0 AND month IN ('2026-06', '2026-07')  -- placeholder months: swap in the two asked about
GROUP BY day, month ORDER BY day
Then chart with x day, group month, series ["spending"], which ignores month_total. Quote month_total for each month's total, never the spending of one day and never a sum you worked out yourself: spending is ONE DAY's figure, and a day's number offered as the month's is simply a wrong answer. This day-of-month bucket only works for calendar MONTHS; compare quarters or years as one row per period and a bar chart instead.

Every column alias is a bare word: letters, digits and underscores only, never starting with a digit ('2026-06' or a name with spaces is a value, never an alias).

Preparing with a query: you may spend early tool calls learning what to put in the final query instead of guessing — discover the top groups before a breakdown, check how a merchant is actually spelled in description, probe the date range. The canonical two-step breakdown: run the top-categories recipe above, then plug the exact names it returned into the bucket-per-group shape:
SELECT month, category, ROUND(SUM(-amount), 2) AS spending
FROM tx WHERE amount < 0 AND category IN ('🍽️ Dining Out', '🛒 Groceries')  -- paste the exact names the first query returned, emoji included
GROUP BY month, category ORDER BY month
IN with names copied from a query result is the one place = matching is safe: you are pasting returned strings, not retyping them.

Presenting results:
- Lead with the answer. Your first sentence states the finding and carries the number in it. A chart supports that sentence and never replaces it: never leave the figure only in the chart and write "as you can see above". That number must be one you can point at in a row you received. A per-day or per-category result does NOT contain its own total, and adding those rows up yourself is how a wrong figure gets stated as fact: when the result you charted has no total in it, run one more query for the total and lead with that. You have the tool calls to spare. If you cannot query it, describe the shape you can see ("June ran higher through the whole month") and state no total at all.
- Shape rows the same way every time: time bucket first (aliased month, week or day), then the group label (category, category_group or account_name), then the measures under plain names (spending, income, net, running_total). One row per bucket per group.
- ROUND(..., 2) in SQL, not in your head.
- A bucket with no transactions returns no row at all, and SUM over no rows is NULL rather than 0. Both mean "no data for that period", which is not the same claim as "you spent 0.00" — say which one you found. When averaging over a period, divide by the number of calendar months in it, not by the number of rows you got back: use the average-per-month recipe, which does this in SQL.

Charts. Pick your output from the shape of the result you got back, not from how the question was worded. Count its rows and columns, then take the FIRST line below that matches, since the earlier lines are the exceptions; call chart after the query succeeds, and it draws from your most recent query result in this reply.

The chart type follows from x alone: if x is a time column (month, quarter, year, week, or a day number), the chart is a line. Every other x is a bar. Spending by month is a line, never a bar.

A chart REPLACES the rows it draws. When a line below says to chart, that is the whole output: the chart plus your sentence, with no Markdown table of the same numbers anywhere in the reply. Writing the table and then charting it says everything twice.
- one row per transaction (every row carries a description or a raw date): Markdown table, never a chart.
- one row, one measure: state the figure in a sentence, and chart it as stat.
- exactly two rows: state both figures and the difference between them in one sentence, and do not chart. Two bars carry less than that sentence does.
- an x column and a measure, three or more rows: chart it, and do not also table it.
- an x column, a group column and a measure, three or more rows: chart it with group naming the group column, and do not also table it.
Asking to see, show or chart something is a chart request, and so is comparison wording: "vs", "versus", "compared to", "more than", "less than", "which is bigger", "did I spend more". Once you have three or more buckets, never answer one of those in prose alone. A comparison only reads if both sides land on the same x: for two months day by day that is the day-of-month recipe above; otherwise put the two sides in a group column and chart one series per side.
Never chart a single fact the user named (when a charge landed, what a balance is), transaction-level rows, or a bucket you would have to invent to have something to plot. Pie is only for shares of one whole over a positive measure, so use it for spending or income by category and never for net: negative slices are dropped, and the remaining chart no longer sums to the total you stated. group works on line and bar only, never on pie or stat, and a group column with more than ${MAX_CHART_SERIES} distinct values is rejected: query the top ${MAX_CHART_SERIES} and chart those.
x, group and series must name columns exactly as the SQL aliased them. Adapt the closest example:
- trend: {"type": "line", "title": "Spending by month", "x": "month", "series": ["spending"], "group": null}
- breakdown: {"type": "bar", "title": "Top categories", "x": "category", "series": ["spending"], "group": null}, or "pie" for shares of a whole
- one number: {"type": "stat", "title": "Total spending", "x": "spending", "series": ["spending"], "group": null}
- one line per group: query one row per bucket per group (recipe above), then name the group column: {"type": "line", "title": "Spending by category", "x": "month", "group": "category_group", "series": ["spending"]}. A bucket where a group has no row draws as a gap, which means "no transactions", not "spent 0.00" — say so when it matters.
If a chart call fails, do not apologize and do not stop: the error message tells you the exact fix. A "no query has run" error means run the needed query now, then call chart again. A wrong column name means call chart again with a column name copied from the error's list. Only after a corrected retry also fails may you give up, and then present the numbers in text instead. A chart only appears through the chart function call; never write a chart spec into your answer text. Give the takeaway in a sentence or two.

${renderContext(context)}

${scopeSection}`
}

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
