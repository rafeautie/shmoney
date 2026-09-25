import { addMonths, format } from 'date-fns'
import { computePace, parseLocalDay } from '../../../goals/pace'
import {
  currenciesOf,
  fail,
  leftOutNote,
  matchedNote,
  round2,
  txWhere,
  type AnalysisContext,
  type TxFilter,
  type ToolOutput
} from './common'
import { completeMonths, monthEnd, monthStart, resolvePeriod } from './period'

export interface MonthlyAverages {
  /** the complete months averaged over, at most the last six */
  months: string[]
  spending: number
  income: number
  /** the one currency averaged: filter.currency, else the most used when the rows mix */
  currency: string | null
  /** the currencies the averages leave out */
  leftOut: string[]
}

/**
 * Average monthly spending and income over the last six complete months (fewer
 * when the data is younger), sign-based like the Reports engine. Currencies are
 * never added together, so rows in several keep to one.
 */
export function monthlyAverages(ctx: AnalysisContext, filter: TxFilter = {}): MonthlyAverages {
  const period = resolvePeriod('last_6_months', ctx.today, ctx.data)
  const months = period.ok ? completeMonths(period.window, ctx.today, ctx.data) : []
  if (months.length === 0) return { months, spending: 0, income: 0, currency: null, leftOut: [] }
  const window = {
    start: monthStart(months[0]),
    end: monthEnd(months[months.length - 1]),
    label: '',
    partial: false
  }
  const found = currenciesOf(ctx, { ...filter, currency: null, window })
  const currency = filter.currency ?? (found.length > 1 ? found[0] : null)
  const leftOut = currency ? found.filter((c) => c !== currency) : []
  const where = txWhere({ ...filter, currency, window })
  const row = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spending, ` +
        `COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income FROM temp.tx ${where.sql}`
    )
    .get(...where.params) as { spending: number; income: number }
  return {
    months,
    spending: row.spending / months.length,
    income: row.income / months.length,
    currency,
    leftOut
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const MAX_PROJECTION_MONTHS = 1200

const rate = (net: number, income: number): number | null =>
  income > 0 ? Math.round((net / income) * 1000) / 10 : null

export function runWhatIf(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const category = text(args.category)
  // both given means a merchant inside a category (Netflix within Subscriptions)
  const search = text(args.search)
  const percent = num(args.change_percent)
  const perMonth = percent === null ? num(args.change_per_month) : null
  if (percent === null && perMonth === null)
    return fail(
      'Give the change as change_percent (e.g. -50 to halve it) or change_per_month (e.g. -200).',
      started
    )

  const goalName = text(args.goal)
  const goal = goalName
    ? ctx.goalPace.find((g) => g.name.toLowerCase() === goalName.toLowerCase())
    : null
  if (goalName && !goal)
    return fail(
      ctx.goalPace.length
        ? `No goal named '${goalName}'. The goals are: ${ctx.goalPace.map((g) => g.name).join(', ')}.`
        : 'The user has no active savings goals.',
      started
    )

  const all = monthlyAverages(ctx)
  const n = all.months.length
  if (n === 0) return fail('There is not a complete month of transactions to average yet.', started)
  const target =
    category || search ? monthlyAverages(ctx, { category, search, currency: all.currency }) : all

  const current = target.spending
  const next = Math.max(0, percent !== null ? current * (1 + percent / 100) : current + perMonth!)
  const saving = current - next
  const netNow = all.income - all.spending
  const netAfter = netNow + saving

  const facts: Record<string, unknown> = {
    target: search ? `'${search}'` : (category ?? 'all spending'),
    months_averaged: n,
    current_monthly_spending: round2(current),
    new_monthly_spending: round2(next),
    monthly_saving: round2(saving),
    yearly_saving: round2(saving * 12),
    net_per_month_now: round2(netNow),
    net_per_month_after: round2(netAfter),
    savings_rate_now_percent: rate(netNow, all.income),
    savings_rate_after_percent: rate(netAfter, all.income)
  }
  const notes: string[] = []
  const period = `${all.months[0]} to ${all.months[n - 1]} (${n} complete months)`
  if (n < 6)
    notes.push(`Only ${n} complete month${n === 1 ? '' : 's'} of data, so averaged over those.`)
  const matched = search ? matchedNote(ctx, { category, search }) : null
  if (matched) notes.push(matched)
  if (all.currency && all.leftOut.length) notes.push(leftOutNote(all.currency, all.leftOut))
  if (current === 0)
    notes.push('Nothing was spent on this in those months, so there is nothing to change.')

  if (goal) {
    const nowDate = parseLocalDay(ctx.today)
    nowDate.setHours(12)
    const pace = computePace({ ...goal, now: Math.floor(nowDate.getTime() / 1000) })
    facts.goal = goal.name
    if (pace.status === 'reached') {
      notes.push(`${goal.name} is already reached.`)
    } else {
      const monthsAt = (perMonthMilli: number): number | null => {
        if (perMonthMilli <= 0) return null
        const months = Math.ceil(pace.remaining / perMonthMilli)
        return months > MAX_PROJECTION_MONTHS ? null : months
      }
      const monthsNow = monthsAt(pace.averagePerMonth)
      const monthsAfter = monthsAt(pace.averagePerMonth + saving * 1000)
      facts.goal_projected_date_now = pace.projectedDate
      facts.goal_projected_date_after =
        monthsAfter === null ? null : format(addMonths(nowDate, monthsAfter), 'yyyy-MM-dd')
      facts.months_sooner =
        monthsNow !== null && monthsAfter !== null ? monthsNow - monthsAfter : null
      if (monthsAfter === null)
        notes.push(`At this pace ${goal.name} has no projected date: nothing is going toward it.`)
    }
  }

  return {
    result: {
      ok: true,
      period,
      facts,
      ...(notes.length ? { notes } : {}),
      durationMs: Date.now() - started
    },
    chart: null
  }
}
