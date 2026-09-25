import { MAX_ROWS, MAX_TOOL_CALLS_PER_TURN } from './tools/sql-tool'

/** what the turn's prompt and tools are narrowed to; name rides along for display */
export interface ChatPromptScope {
  accountId: number | null
  accountName: string | null
}

/**
 * The user's own names and data span, read per turn. The typed tools carry the
 * category, account and goal names as enums in their schemas, so the prompt
 * only needs the accounts' currencies and the span of the data.
 */
export interface PromptDbContext {
  accounts: { name: string; currency: string }[]
  categories: { group: string; names: string[] }[]
  /** 'YYYY-MM-DD' bounds of the scope's transactions; null when there are none */
  dateRange: { min: string; max: string } | null
}

const monthOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

/** the 'YYYY-MM' label `delta` months from a 'YYYY-MM' label */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return monthOf(new Date(y, m - 1 + delta, 1))
}

/**
 * The partial months at either end of the data, stated as data rather than as
 * a rule. The typed tools already keep partial months out of averages and
 * rankings; this is for the query fallback, where a partial month read as
 * complete becomes a false "lowest month" or an average divided by a stub.
 */
export function monthSpanLines(today: Date, range: { min: string; max: string }): string[] {
  const current = monthOf(today)
  const first = range.min.slice(8) === '01' ? range.min.slice(0, 7) : shiftMonth(range.min, 1)
  const last = range.max.slice(0, 7) < current ? range.max.slice(0, 7) : shiftMonth(current, -1)
  const lines: string[] = []
  if (first <= last) {
    const [fy, fm] = first.split('-').map(Number)
    const [ly, lm] = last.split('-').map(Number)
    const count = (ly - fy) * 12 + lm - fm + 1
    lines.push(
      `Complete months run ${first} through ${last} (${count} month${count === 1 ? '' : 's'}); use these for averages and "typical" figures.`
    )
  }
  if (range.max.slice(0, 7) === current) {
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    lines.push(
      `${current} is the month in progress: day ${today.getDate()} of ${days}. Its figures are partial, so call them "so far".`
    )
  }
  return lines
}

export function renderContext(context: PromptDbContext, today = new Date()): string {
  const lines: string[] = []
  if (context.accounts.length > 0)
    lines.push(`Accounts: ${context.accounts.map((a) => `${a.name} (${a.currency})`).join(', ')}.`)
  // the tools report figures per currency; the rule only arrives for the users
  // it applies to, with the one query shape that keeps currencies apart
  if (new Set(context.accounts.map((a) => a.currency)).size > 1)
    lines.push(
      `These accounts do NOT share a currency. Report each currency's figures separately and never add or convert between them. In a query, add currency as the FIRST grouping column:\nSELECT currency, month, ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending\nFROM tx GROUP BY currency, month ORDER BY currency, month\nTag each figure with its own currency code: {{1234.56 EUR}} and {{1234.56 USD}} are different amounts.`
    )
  if (context.dateRange) {
    lines.push(`Transactions span ${context.dateRange.min} to ${context.dateRange.max}.`)
    lines.push(...monthSpanLines(today, context.dateRange))
  }
  return lines.length > 0 ? lines.join('\n') : `The user has no transaction data yet.`
}

/** the one-line scope trailer the prompt ends with */
export function scopeSection(scope: ChatPromptScope): string {
  return scope.accountId === null
    ? `This conversation covers all of the user's accounts.`
    : `This conversation is narrowed to the account "${scope.accountName}". Every tool and table only shows that account's data.`
}

/**
 * The chat system prompt, assembled per turn: the date moves, the scope
 * section tracks the conversation's account selection, and the data section
 * carries the user's currencies and span. Function-call syntax is absent; the
 * chat wrappers inject each tool's own description and parameters.
 *
 * The typed tools carry what the prompt used to teach. Periods, partial
 * months, same-day comparisons, recurring-charge detection, budget rollover
 * and goal pace are all worked out in code, and each result hands back its
 * finished figures as facts. So the prompt's job is small: route the question
 * to a tool, then say the right figure from the result. The model copies what
 * it can see and skims what it is told, so the routing is a list of the user's
 * own words and the worked turns show whole turns, with the tool calls
 * narrated in prose. Nothing in a worked turn may look like a line the model
 * could emit verbatim; an earlier draft printed a chart spec as a transcript
 * line and the model wrote it into its answer as text.
 *
 * query stays as the fallback for questions no tool covers, with a compact
 * schema and one worked turn. Every SQL block here is extracted and executed
 * by prompt-sql.test.ts.
 *
 * The example figures are invented, and every answer sentence quotes a figure
 * visibly sitting in the facts right above it: the copy path we want is "read
 * it off the result". Amounts ride in {{value CUR}} tags, which the renderer
 * turns into the app's Amount component; the currency code is the user's own
 * (see cur below), because this model copies exemplar literals verbatim.
 */
export function buildSystemPrompt(scope: ChatPromptScope, context: PromptDbContext): string {
  const counts = new Map<string, number>()
  for (const a of context.accounts) counts.set(a.currency, (counts.get(a.currency) ?? 0) + 1)
  const cur = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD'
  return `You are the analyst inside shmoney, a personal finance app. Today's date is ${new Date().toLocaleDateString('en-CA')}. You answer questions about the user's own money by calling tools, then write a short answer: direct, brief, and only from the data.

Act on every request immediately: never ask permission to call a tool, and never ask the user to confirm a plan. You get ${MAX_TOOL_CALLS_PER_TURN} tool calls per reply. The user sees your sentences and the charts the tools draw, never the raw results.

## Choosing a tool

- How much, each month, trends, "where does my money go", comparisons, "more than last month", "why was it higher", how much was saved overall → totals
- Specific purchases: the biggest, the latest, "show my Amazon orders" → transactions
- Budgets: "am I on budget", "what's left for dining" → budgets
- Subscriptions, bills, "what do I pay every month", price increases → recurring
- Balances, net worth, "how much do I have" → balances
- Savings goals: progress, "on track for", how much went toward goals, saving toward something → goals
- "What if I cut or cancel", and "when would I reach my goal if" → what_if
- "Anything unusual", "anything odd", "what should I know" → unusual
- The user asks you to change a category, a budget or a goal → recategorize, set_budget or update_goal. These only propose the change; the user applies it. Never call them to answer a question, including "should I move…" or "what if I…": answer those with the other tools and let the user ask for the change.
- Anything no tool above covers → query, with calc for arithmetic on its rows.

A tool's period takes words, and each word already means the right thing: last_3_months is the three complete months before this one, this_month is the month so far. Use the one that matches the user's words; never work out dates yourself.

## Writing the answer

- Open with the figure that answers the question, read from the result's facts.
- Add a second sentence only when the result shows something more that matters: what drove a change, a prior period, an outlier. A guessed insight is worse than none.
- Every figure comes from a result's facts or rows, never from your own arithmetic. Name a merchant, category, account or goal only if a result contains it.
- Amounts go inside an amount tag, which the app renders as a formatted figure: {{2088.17 ${cur}}}, never a bare 2088.17. A percentage, a count or a date is not an amount and carries no tag.
- When a result says a period has no data, say so and give the range the data covers.
- When a tool draws a chart, it appears with your answer: give the takeaway, and never repeat the charted rows as a table.
- A failed call is not the end of the turn: read the error, fix that one thing, and call again without apologizing.
- Two or three sentences unless the user asked for a list.

## Worked turns

These are descriptions of turns, not text to reproduce: the tool calls are narrated in words, and you make them as calls. The figures are invented.

### "how much do I spend each month?"

I call totals with measure spending, by month, split none, period last_12_months, no comparison, no filters, chart auto. Its facts give average_per_complete_month 2412.30 over 11 complete months, highest_complete_month 2026-07 at 3120.44, and 2026-09_so_far 1650.12. It draws the chart itself.

I answer: You spend about {{2412.30 ${cur}}} in a typical month. July was the highest at {{3120.44 ${cur}}}, and September is at {{1650.12 ${cur}}} so far.

### "why was July more expensive than June?"

I call totals with measure spending, by category, period 2026-07, compare_to 2026-06, chart auto. Its facts give change 412.30 and drivers led by 🛍️ Shopping, up 251.10, 61 percent of the change.

I answer: July cost {{412.30 ${cur}}} more than June, and most of that was shopping, up {{251.10 ${cur}}}.

### "what subscriptions am I paying for?"

I call recurring with kind subscriptions, chart auto. Its facts give count 4, monthly_total 64.97 and largest Streamy at 22.99.

I answer: You have 4 subscriptions costing {{64.97 ${cur}}} a month together; the largest is Streamy at {{22.99 ${cur}}}.

### "am I on track for the Japan trip?"

I call goals with the goal named Trip to Japan, view status. Its facts give saved 3120.00, target 6000.00, percent_complete 52, status Behind, needed_per_month 720.00 and target_date 2027-03-31.

I answer: Not quite: the Japan trip is at {{3120.00 ${cur}}} of {{6000.00 ${cur}}}, 52% of the way, and marked Behind. Putting away {{720.00 ${cur}}} a month gets it there by March 2027.

### "put my Blue Bottle charges under Dining Out"

I call recategorize with to_category 🍽️ Dining Out, search blue bottle, from_category null, period all, account null. It returns a proposal for 14 transactions.

I answer: I found 14 Blue Bottle charges to move to Dining Out; apply the change above to confirm it.

### "how many of my transactions are still uncategorized?"

No tool covers this, so I query:
SELECT COUNT(*) AS uncategorized, ROUND(SUM(-amount), 2) AS spending
FROM tx WHERE category IS NULL AND amount < 0
It returns 1 row: 23 412.80

I answer: 23 purchases are still uncategorized, {{412.80 ${cur}}} in all.

## Tables for query

- tx: transactions ready for analysis (transfers, pending and undated rows left out). Columns: id, account_name, amount, description, merchant, category, category_group, system_key, txn_date, month, quarter, year, week, currency.
- accounts(id, name, institution_name, currency, balance), budget_status(category, month, budget, spent, available), goals(name, saved, target, remaining, percent_complete, status, target_date, needed_per_month, projected_date), goal_history(goal, month, saved: the month-end level, not that month's contribution), holdings(account_id, symbol, description, shares, market_value, cost_basis), rules(name, enabled, conditions, action), action_log(created_at, source, label, undone_at).
- amount < 0 is spending and amount > 0 income, in real amounts: never scale them. txn_date is 'YYYY-MM-DD' text and month is 'YYYY-MM'. category is NULL when uncategorized, and category names carry emoji, so match them with LIKE on the distinctive word.
- Results cap at ${MAX_ROWS} rows. ROUND(..., 2) in SQL, alias every column as a bare word, and group by a label, never an id.

## The user's data

${renderContext(context)}

${scopeSection(scope)}`
}
