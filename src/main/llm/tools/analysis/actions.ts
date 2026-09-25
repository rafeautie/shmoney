// The action tools: each one reads what a change would do and returns it as a
// proposal. Nothing here writes; the user applies a proposal from the chat and
// the main process saves it through the app's own save paths (chat-proposals).
import type {
  ActionToolName,
  Proposal,
  ProposalDisplay,
  ProposalMerchantGroup,
  ProposalToolResult
} from '@shared/chat'
import { GOAL_STATUS_LABELS } from '@shared/goals'
import { endOfDay } from 'date-fns'
import { computePace, parseLocalDay } from '../../../goals/pace'
import { leftOutNote, round2, txWhere, type AnalysisContext, type GoalPaceInput } from './common'
import { completeMonths, resolvePeriod } from './period'

export interface ProposalOutput {
  result: ProposalToolResult
  display: ProposalDisplay | null
}

/** past this, a recategorize is too broad to review as one card */
export const MAX_RECATEGORIZE = 500

const NOTE =
  'The change is shown for the user to apply; say in one sentence what it will do. Do not call more tools.'

const money = (n: number): string => Math.abs(n).toFixed(2)
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

function fail(error: string): ProposalOutput {
  return { result: { ok: false, error }, display: null }
}

function propose(proposal: Proposal, summary: string): ProposalOutput {
  return {
    result: { ok: true, summary, note: NOTE },
    display: {
      proposal,
      status: 'approval-requested',
      actionId: null,
      applied: null,
      skipped: null
    }
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function runAction(
  name: ActionToolName,
  args: Record<string, unknown>,
  ctx: AnalysisContext
): ProposalOutput {
  switch (name) {
    case 'recategorize':
      return recategorize(args, ctx)
    case 'set_budget':
      return setBudget(args, ctx)
    case 'update_goal':
      return updateGoal(args, ctx)
  }
}

interface CategoryMatch {
  id: number
  name: string
  systemKey: string | null
  groupName: string | null
}

// names are unique only within a group, so a bare name can mean two categories;
// guessing would write to the wrong one, so an ambiguous name is refused
function categoryByName(
  ctx: AnalysisContext,
  name: string
): { ok: true; category: CategoryMatch | null } | { ok: false; error: string } {
  const rows = ctx.db
    .prepare(
      `SELECT c.id, c.name, c.system_key AS systemKey, g.name AS groupName
       FROM main.categories c LEFT JOIN main.category_groups g ON g.id = c.group_id
       WHERE c.name = ? ORDER BY c.id`
    )
    .all(name) as CategoryMatch[]
  const user = rows.filter((r) => r.systemKey === null)
  if (user.length > 1) {
    const groups = user.map((r) => (r.groupName === null ? 'ungrouped' : `'${r.groupName}'`))
    return {
      ok: false,
      error: `More than one category is named '${name}' (${groups.join(', ')}), so it's unclear which one is meant. Tell the user to rename one of them on the Categories page.`
    }
  }
  return { ok: true, category: rows[0] ?? null }
}

// everyday words for the default categories, for when the user's word shares
// no stem with the category's name
const SYNONYMS: Record<string, string[]> = {
  dining: ['eating', 'restaurant', 'restaurants', 'takeout', 'food', 'coffee', 'lunch', 'dinner'],
  groceries: ['grocery', 'supermarket', 'food'],
  transportation: ['gas', 'fuel', 'car', 'uber', 'transit', 'parking'],
  housing: ['rent', 'mortgage', 'home'],
  utilities: ['electric', 'electricity', 'water', 'internet', 'phone'],
  subscriptions: ['streaming', 'subscription'],
  entertainment: ['movies', 'fun', 'games'],
  healthcare: ['health', 'medical', 'doctor', 'pharmacy']
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)

/**
 * Whether the user's own words plausibly name this category: a shared stem
 * or a known everyday synonym. The grammar forces the category to a real
 * name, so this is what catches "pet supplies" landing on Shopping.
 */
export function matchesAsked(asked: string, category: string): boolean {
  const said = words(asked)
  if (said.length === 0) return true
  const named = words(category)
  const stem = (w: string): string => w.slice(0, 4)
  return named.some(
    (n) =>
      said.some((w) => stem(w) === stem(n)) || (SYNONYMS[n] ?? []).some((syn) => said.includes(syn))
  )
}

function askedMismatch(asked: string, ctx: AnalysisContext): string {
  return `No category matches '${asked}'. The categories are: ${ctx.vocab.categories.join(', ')}. Tell the user there is no category like that and name the closest ones; do not propose a change to a different category unless they ask for it.`
}

function singleCurrency(currencies: (string | null)[]): string | null {
  const set = new Set(currencies.filter((c): c is string => c !== null))
  return set.size === 1 ? [...set][0] : null
}

interface MatchRow {
  id: number
  categoryId: number | null
  date: string
  description: string
  merchant: string | null
  amount: number
  category: string | null
  currency: string | null
}

function recategorize(args: Record<string, unknown>, ctx: AnalysisContext): ProposalOutput {
  const toName = str(args.to_category)
  if (!toName) return fail('Say which category to move the transactions to.')
  const toMatch = categoryByName(ctx, toName)
  if (!toMatch.ok) return fail(toMatch.error)
  const to = toMatch.category
  if (!to) return fail(`There is no category named '${toName}'.`)
  const search = str(args.search)
  const asked = str(args.as_asked)
  // a model sometimes puts the merchant here; that names the rows, not the category
  const namesRows = asked !== null && search !== null && matchesAsked(asked, search)
  if (asked && !namesRows && !matchesAsked(asked, to.name)) return fail(askedMismatch(asked, ctx))
  const period = resolvePeriod(str(args.period) ?? 'all', ctx.today, ctx.data)
  if (!period.ok) return fail(period.error)
  const account = str(args.account)
  const from = str(args.from_category)
  if (from && from !== 'Uncategorized') {
    const fromMatch = categoryByName(ctx, from)
    if (!fromMatch.ok) return fail(fromMatch.error)
  }

  const where = txWhere({ window: period.window, account, search })
  const clauses = where.sql ? [where.sql.replace(/^WHERE /, '')] : []
  const params = [...where.params]
  if (from === 'Uncategorized') clauses.push('category_id IS NULL')
  else if (from) {
    clauses.push('category = ?')
    params.push(from)
  }
  clauses.push('category_id IS NOT ?')
  params.push(to.id)
  const rows = ctx.db
    .prepare(
      `SELECT id, category_id AS categoryId, txn_date AS date, description, merchant, amount,
         category, currency
       FROM temp.tx WHERE ${clauses.join(' AND ')} ORDER BY txn_date DESC, id DESC`
    )
    .all(...params) as MatchRow[]

  if (rows.length === 0) {
    const what = [
      search ? `matching '${search}'` : null,
      from ? `in ${from}` : null,
      account ? `on ${account}` : null
    ].filter(Boolean)
    return fail(
      `No transactions ${what.length ? `${what.join(' ')} ` : ''}in ${period.window.label} outside ${to.name}. Try a wider period or a different search.`
    )
  }
  if (rows.length > MAX_RECATEGORIZE)
    return fail(
      `${rows.length} transactions matched, more than ${MAX_RECATEGORIZE}. Narrow it with a search, a period or from_category.`
    )

  const byMerchant = new Map<string, Required<ProposalMerchantGroup>>()
  for (const row of rows) {
    const merchant = row.merchant ?? '(no description)'
    const group = byMerchant.get(merchant) ?? {
      merchant,
      transactionIds: [],
      fromCategoryIds: [],
      total: 0
    }
    group.transactionIds.push(row.id)
    group.fromCategoryIds.push(row.categoryId)
    group.total += row.amount
    byMerchant.set(merchant, group)
  }
  const groups = [...byMerchant.values()]
    .map((g) => ({ ...g, total: round2(g.total) }))
    .sort((a, b) => b.transactionIds.length - a.transactionIds.length)

  const total = round2(rows.reduce((sum, r) => sum + r.amount, 0))
  const shown = groups.slice(0, 3).map((g) => `${g.merchant} ${g.transactionIds.length}`)
  if (groups.length > 3) shown.push(`${groups.length - 3} more`)
  const summary = `Proposed moving ${plural(rows.length, 'transaction')} (${shown.join(', ')}) totaling ${money(total)} to ${to.name}.`

  return propose(
    {
      kind: 'recategorize',
      toCategoryId: to.id,
      toCategory: to.name,
      groups,
      sample: rows.slice(0, 5).map((r) => ({
        id: r.id,
        date: r.date,
        description: r.description,
        amount: r.amount,
        category: r.category
      })),
      currency: singleCurrency(rows.map((r) => r.currency))
    },
    summary
  )
}

function setBudget(args: Record<string, unknown>, ctx: AnalysisContext): ProposalOutput {
  const name = str(args.category)
  if (!name) return fail('Say which category to budget.')
  const match = categoryByName(ctx, name)
  if (!match.ok) return fail(match.error)
  const category = match.category
  if (!category) return fail(`There is no category named '${name}'.`)
  const asked = str(args.as_asked)
  if (asked && !matchesAsked(asked, category.name)) return fail(askedMismatch(asked, ctx))
  if (category.systemKey !== null)
    return fail(`${category.name} is a system category and can't have a budget.`)
  const amount = num(args.amount)
  if (amount === null || amount <= 0) return fail('The budget amount has to be more than 0.')
  const fromMonth = str(args.from_month)
  if (fromMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth))
    return fail(`from_month must be 'YYYY-MM', not '${fromMonth}'.`)
  const month = fromMonth ?? ctx.today.slice(0, 7)

  const current = ctx.db
    .prepare(
      'SELECT amount FROM temp.budgets WHERE category_id = ? AND month <= ? ORDER BY month DESC LIMIT 1'
    )
    .get(category.id, month) as { amount: number } | undefined
  const before = current ? round2(current.amount) : null

  const window = resolvePeriod('last_6_months', ctx.today, ctx.data)
  const months = window.ok ? completeMonths(window.window, ctx.today, ctx.data) : []
  let averageSpending: number | null = null
  // one average per currency, most used first; only the first is shown
  let spent: { currency: string; spent: number }[] = []
  if (months.length > 0) {
    spent = ctx.db
      .prepare(
        `SELECT currency, SUM(-amount) AS spent FROM temp.tx
         WHERE category_id = ? AND amount < 0 AND month IN (${months.map(() => '?').join(', ')})
         GROUP BY currency ORDER BY COUNT(*) DESC, currency`
      )
      .all(category.id, ...months) as { currency: string; spent: number }[]
    averageSpending = round2((spent[0]?.spent ?? 0) / months.length)
  }
  const currency =
    spent[0]?.currency ??
    singleCurrency(
      (
        ctx.db.prepare('SELECT DISTINCT currency FROM temp.tx').all() as {
          currency: string | null
        }[]
      ).map((r) => r.currency)
    )

  const after = round2(amount)
  let summary = `Proposed a ${category.name} budget of ${money(after)} a month from ${month} (${before === null ? 'no budget now' : `now ${money(before)}`}).`
  if (spent.length > 1)
    summary += ` ${leftOutNote(
      spent[0].currency,
      spent.slice(1).map((s) => s.currency)
    )}`
  return propose(
    {
      kind: 'set_budget',
      categoryId: category.id,
      category: category.name,
      month,
      before,
      after,
      averageSpending,
      currency
    },
    summary
  )
}

/** unix seconds at local noon of a 'YYYY-MM-DD' day, the app's day convention */
function noonOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000)
}

function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function paceOf(
  goal: GoalPaceInput,
  targetAmount: number,
  targetDate: string | null,
  now: number
): { status: string; neededPerMonth: number | null; projectedDate: string | null } {
  const pace = computePace({
    targetAmount,
    baselineAmount: goal.baselineAmount,
    progress: goal.progress,
    startedAt: goal.startedAt,
    targetDate,
    now
  })
  return {
    status: GOAL_STATUS_LABELS[pace.status],
    neededPerMonth: pace.neededPerMonth === null ? null : round2(pace.neededPerMonth / 1000),
    projectedDate: pace.projectedDate
  }
}

function updateGoal(args: Record<string, unknown>, ctx: AnalysisContext): ProposalOutput {
  const name = str(args.goal)
  if (!name) return fail('Say which goal to change.')
  const goal = ctx.goalPace.find((g) => g.name === name)
  if (!goal) return fail(`There is no active savings goal named '${name}'.`)
  const targetAmount = args.target_amount === null ? null : num(args.target_amount)
  if (args.target_amount !== null && args.target_amount !== undefined && targetAmount === null)
    return fail('target_amount must be a number or null.')
  if (targetAmount !== null && targetAmount <= 0)
    return fail('The target amount has to be more than 0.')
  const targetDate = str(args.target_date)
  const archive = args.archived === true

  const before = {
    targetAmount: round2(goal.targetAmount / 1000),
    targetDate: goal.targetDate,
    archived: false
  }
  const after = {
    targetAmount: targetAmount === null ? before.targetAmount : round2(targetAmount),
    targetDate: targetDate ?? before.targetDate,
    archived: archive
  }
  if (targetDate !== null) {
    if (!isRealDay(targetDate))
      return fail(`target_date must be 'YYYY-MM-DD', not '${targetDate}'.`)
    if (Math.floor(endOfDay(parseLocalDay(targetDate)).getTime() / 1000) <= goal.startedAt)
      return fail(
        `The target date has to be after the goal's start. Tell the user; do not propose a different date unless they ask for one.`
      )
    // an archived goal's date is history, so a past one is fine there
    if (!archive && targetDate <= ctx.today)
      return fail(
        `The target date has to be after ${ctx.today}. Tell the user; do not propose a different date unless they ask for one.`
      )
  }
  const amountChanged = after.targetAmount !== before.targetAmount
  const dateChanged = after.targetDate !== before.targetDate
  if (!amountChanged && !dateChanged && !archive)
    return fail(
      `That wouldn't change ${goal.name}: give a new target_amount or target_date, or archived true.`
    )

  const now = noonOf(ctx.today)
  const pace = {
    before: paceOf(goal, goal.targetAmount, before.targetDate, now),
    after: paceOf(goal, Math.round(after.targetAmount * 1000), after.targetDate, now)
  }

  const changes: string[] = []
  if (amountChanged) changes.push(`target to ${money(after.targetAmount)}`)
  if (dateChanged) changes.push(`target date to ${after.targetDate}`)
  let summary: string
  if (archive)
    summary = `Proposed archiving ${goal.name}${changes.length ? ` and moving its ${changes.join(' and ')}` : ''}.`
  else {
    const outlook =
      pace.after.neededPerMonth !== null
        ? `it would need ${money(pace.after.neededPerMonth)} a month and be ${pace.after.status}`
        : `it would be ${pace.after.status}`
    summary = `Proposed moving ${goal.name}'s ${changes.join(' and ')}; ${outlook}.`
  }

  return propose(
    {
      kind: 'update_goal',
      goalId: goal.id,
      goal: goal.name,
      before,
      after,
      pace,
      currency: goal.currency
    },
    summary
  )
}
