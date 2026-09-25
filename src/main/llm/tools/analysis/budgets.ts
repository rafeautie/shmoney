import type { ChartSpec } from '@shared/chat'
import { fail, leftOutNote, round2, type AnalysisContext, type ToolOutput } from './common'
import { savedInMonth } from './goals'
import { monthEnd, monthOfDay } from './period'

interface StatusRow {
  category: string
  budget: number
  spent: number
  available: number
}

// a budget's spending, as budget_status counts it
const SPEND = "t.category_id = s.category_id AND t.amount < 0 AND t.system_key IS NOT 'opening'"

const STATUS_ORDER: Record<string, number> = { over: 0, 'at risk': 1, 'on track': 2 }

export function runBudgets(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const current = monthOfDay(ctx.today)
  const month = typeof args.month === 'string' && args.month.trim() ? args.month.trim() : current
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return fail(
      `'${month}' is not a month. Use 'YYYY-MM', e.g. '2026-07', or null for this month.`,
      started
    )

  // budget_status adds every currency's spending together; budgets keep to the
  // most used one, and the rest comes back out of spent and the rolled-over available
  const currencies = (
    ctx.db
      .prepare(
        `SELECT t.currency, COUNT(*) AS n FROM temp.transactions t
         JOIN (SELECT category_id, MIN(month) AS start FROM main.budgets GROUP BY category_id) s
           ON ${SPEND} AND t.month >= s.start AND t.month <= ?
         GROUP BY t.currency ORDER BY n DESC, t.currency`
      )
      .all(month) as { currency: string }[]
  ).map((r) => r.currency)
  const currency = currencies[0] ?? null
  const found = (
    ctx.db
      .prepare(
        `SELECT s.category, s.budget, s.spent, s.available,
           (SELECT COALESCE(SUM(-t.amount), 0) FROM temp.transactions t
            WHERE ${SPEND} AND t.month = s.month AND t.currency IS NOT ?) AS other_spent,
           (SELECT COALESCE(SUM(-t.amount), 0) FROM temp.transactions t
            WHERE ${SPEND} AND t.month <= s.month AND t.currency IS NOT ?
              AND t.month >= (SELECT MIN(b.month) FROM main.budgets b WHERE b.category_id = s.category_id)
           ) AS other_to_date
         FROM temp.budget_status s WHERE s.month = ? ORDER BY s.category`
      )
      .all(currency, currency, month) as (StatusRow & {
      other_spent: number
      other_to_date: number
    })[]
  ).map((r) => ({
    category: r.category,
    budget: r.budget,
    spent: round2(r.spent - r.other_spent),
    available: round2(r.available + r.other_to_date)
  }))
  if (found.length === 0)
    return {
      result: {
        ok: true,
        period: month,
        notes: [`No budgets are set for ${month}.`],
        durationMs: Date.now() - started
      },
      chart: null
    }

  const isCurrent = month === current
  const day = Number(ctx.today.slice(8))
  const daysInMonth = Number(monthEnd(month).slice(8))
  const rows = found
    .map((r) => {
      const used = r.budget > 0 ? Math.round((r.spent / r.budget) * 1000) / 10 : null
      const projected = isCurrent ? round2((r.spent / day) * daysInMonth) : null
      const status =
        r.spent > r.budget
          ? 'over'
          : projected !== null && projected > r.budget
            ? 'at risk'
            : 'on track'
      return { ...r, used, projected, status }
    })
    .sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.used ?? 0) - (a.used ?? 0)
    )

  const sum = (pick: (r: StatusRow) => number): number =>
    round2(rows.reduce((s, r) => s + pick(r), 0))
  const facts: Record<string, unknown> = {
    month,
    budgeted: sum((r) => r.budget),
    spent: sum((r) => r.spent),
    available: sum((r) => r.available),
    over: rows.filter((r) => r.status === 'over').map((r) => r.category),
    at_risk: rows.filter((r) => r.status === 'at risk').map((r) => r.category)
  }
  if (isCurrent) facts.days_left = daysInMonth - day
  const goals = ctx.db
    .prepare('SELECT SUM(needed_per_month) AS planned, COUNT(*) AS n FROM temp.goals')
    .get() as {
    planned: number | null
    n: number
  }
  if (goals.n > 0) {
    facts.saved_toward_goals = savedInMonth(ctx, month)
    facts.planned_saving = round2(goals.planned ?? 0)
  }

  const chart: ChartSpec | null =
    args.chart !== 'none' && rows.length >= 2
      ? {
          type: 'bar',
          title: `Budget and spending, ${month}`,
          x: 'category',
          series: ['budget', 'spent'],
          group: null
        }
      : null
  return {
    result: {
      ok: true,
      period: isCurrent ? `${month} so far` : month,
      columns: [
        'category',
        'budget',
        'spent',
        'available',
        'used_percent',
        'projected_spending',
        'status'
      ],
      rows: rows.map((r) => [
        r.category,
        r.budget,
        r.spent,
        r.available,
        r.used,
        r.projected,
        r.status
      ]),
      rowCount: rows.length,
      facts,
      ...(currency && currencies.length > 1
        ? { notes: [leftOutNote(currency, currencies.slice(1))] }
        : {}),
      durationMs: Date.now() - started
    },
    chart
  }
}
