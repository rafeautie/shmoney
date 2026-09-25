import type { ChartSpec } from '@shared/chat'
import { fail, leftOutNote, round2, type AnalysisContext, type ToolOutput } from './common'
import { monthOfDay, shiftMonth } from './period'
import { monthlyAverages } from './what-if'

interface GoalRow {
  id: number
  name: string
  currency: string
  saved: number
  target: number
  remaining: number
  percent_complete: number | null
  status: string
  needed_per_month: number | null
  target_date: string | null
  projected_date: string | null
}

interface HistoryRow {
  goal_id: number
  goal: string
  month: string
  saved: number
}

const money = (n: number | null): number | null => (n === null ? null : round2(n))

/** each goal's month-end level minus the month before's; null with no month before */
export function contributions(
  history: HistoryRow[]
): (HistoryRow & { contributed: number | null })[] {
  const level = new Map(history.map((h) => [`${h.goal_id}|${h.month}`, h.saved]))
  return history.map((h) => {
    const before = level.get(`${h.goal_id}|${shiftMonth(h.month, -1)}`)
    return { ...h, contributed: before === undefined ? null : round2(h.saved - before) }
  })
}

/** what the goals gained in one month, summed over goals */
export function savedInMonth(ctx: AnalysisContext, month: string): number {
  const rows = ctx.db
    .prepare('SELECT goal_id, goal, month, saved FROM temp.goal_history WHERE month IN (?, ?)')
    .all(month, shiftMonth(month, -1)) as HistoryRow[]
  return round2(
    contributions(rows)
      .filter((r) => r.month === month)
      .reduce((sum, r) => sum + (r.contributed ?? 0), 0)
  )
}

export function runGoals(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const name = typeof args.goal === 'string' && args.goal.trim() ? args.goal.trim() : null
  const view = args.view === 'history' ? 'history' : 'status'

  const all = ctx.db
    .prepare(
      'SELECT id, name, currency, saved, target, remaining, percent_complete, status, ' +
        'needed_per_month, target_date, projected_date FROM temp.goals ORDER BY id'
    )
    .all() as GoalRow[]
  if (all.length === 0)
    return {
      result: {
        ok: true,
        notes: ['The user has no active savings goals.'],
        durationMs: Date.now() - started
      },
      chart: null
    }
  const goals = name ? all.filter((g) => g.name.toLowerCase() === name.toLowerCase()) : all
  if (goals.length === 0)
    return fail(
      `No goal named '${name}'. The goals are: ${all.map((g) => g.name).join(', ')}.`,
      started
    )

  return view === 'history'
    ? history(goals, args.chart !== 'none', ctx, started)
    : status(goals, ctx, started)
}

function status(goals: GoalRow[], ctx: AnalysisContext, started: number): ToolOutput {
  const columns = [
    'goal',
    'saved',
    'target',
    'remaining',
    'percent_complete',
    'status',
    'needed_per_month',
    'target_date',
    'projected_date'
  ]
  const rows = goals.map((g) => [
    g.name,
    money(g.saved),
    money(g.target),
    money(g.remaining),
    g.percent_complete,
    g.status,
    money(g.needed_per_month),
    g.target_date,
    g.projected_date
  ])
  const notes: string[] = []
  let facts: Record<string, unknown>
  if (goals.length === 1) {
    const g = goals[0]
    facts = {
      goal: g.name,
      saved: money(g.saved),
      target: money(g.target),
      remaining: money(g.remaining),
      percent_complete: g.percent_complete,
      status: g.status,
      needed_per_month: money(g.needed_per_month),
      target_date: g.target_date,
      projected_date: g.projected_date
    }
  } else {
    const byStatus: Record<string, number> = {}
    for (const g of goals) byStatus[g.status] = (byStatus[g.status] ?? 0) + 1
    facts = { goals: goals.length, by_status: byStatus }
    if (new Set(goals.map((g) => g.currency)).size > 1) {
      notes.push('The goals are in more than one currency, so their amounts are not added up.')
    } else {
      const sum = (pick: (g: GoalRow) => number | null): number =>
        round2(goals.reduce((s, g) => s + (pick(g) ?? 0), 0))
      const needed = sum((g) => g.needed_per_month)
      const averages = monthlyAverages(ctx, { currency: goals[0].currency })
      const net = round2(averages.income - averages.spending)
      Object.assign(facts, {
        total_saved: sum((g) => g.saved),
        total_target: sum((g) => g.target),
        needed_per_month_total: needed,
        saved_this_month: savedInMonth(ctx, monthOfDay(ctx.today))
      })
      if (averages.months.length > 0) {
        Object.assign(facts, {
          average_monthly_net: net,
          can_fund: net >= needed ? 'yes' : 'no'
        })
        if (averages.leftOut.length) notes.push(leftOutNote(goals[0].currency, averages.leftOut))
      }
    }
  }
  return {
    result: {
      ok: true,
      columns,
      rows,
      rowCount: rows.length,
      facts,
      ...(notes.length ? { notes } : {}),
      durationMs: Date.now() - started
    },
    chart: null
  }
}

function history(
  goals: GoalRow[],
  chartWanted: boolean,
  ctx: AnalysisContext,
  started: number
): ToolOutput {
  const ids = goals.map((g) => g.id)
  const found = ctx.db
    .prepare(
      `SELECT goal_id, goal, month, saved FROM temp.goal_history ` +
        `WHERE goal_id IN (${ids.map(() => '?').join(', ')}) ORDER BY month, goal_id`
    )
    .all(...ids) as HistoryRow[]
  const rows = contributions(found)
  const current = monthOfDay(ctx.today)

  const byMonth = new Map<string, number>()
  for (const r of rows)
    if (r.contributed !== null) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.contributed)
  const complete = [...byMonth].filter(([month]) => month < current)
  const best = complete.reduce<[string, number] | null>(
    (top, entry) => (top === null || entry[1] > top[1] ? entry : top),
    null
  )
  const facts: Record<string, unknown> = {
    average_monthly_contribution: complete.length
      ? round2(complete.reduce((s, [, v]) => s + v, 0) / complete.length)
      : null,
    best_month: best ? { month: best[0], contributed: round2(best[1]) } : null,
    contributed_this_month_so_far: round2(byMonth.get(current) ?? 0)
  }
  if (goals.length === 1) facts.goal = goals[0].name

  const months = new Set(rows.map((r) => r.month))
  const chart: ChartSpec | null =
    chartWanted && months.size >= 2
      ? {
          type: 'line',
          title: goals.length === 1 ? `${goals[0].name} saved` : 'Saved toward goals',
          x: 'month',
          series: ['saved'],
          group: goals.length > 1 ? 'goal' : null
        }
      : null
  return {
    result: {
      ok: true,
      period: rows.length ? `${rows[0].month} to ${rows[rows.length - 1].month}` : undefined,
      columns: ['month', 'goal', 'saved', 'contributed'],
      rows: rows.map((r) => [r.month, r.goal, round2(r.saved), r.contributed]),
      rowCount: rows.length,
      facts,
      ...(rows.length ? {} : { notes: ['There is no monthly history for this goal yet.'] }),
      durationMs: Date.now() - started
    },
    chart
  }
}
