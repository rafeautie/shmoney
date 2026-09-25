// totals: one total, a trend, a breakdown or a comparison, with every figure
// the answer might quote finished in facts. Measures are sign-based like the
// Reports engine: spending is money out, income money in, net their difference.
import type { ChartSpec } from '@shared/chat'
import {
  fail,
  matchedNote,
  round2,
  txWhere,
  type AnalysisContext,
  type ToolOutput,
  type TxFilter
} from './common'
import {
  completeMonths,
  coverageNote,
  monthEnd,
  monthOfDay,
  monthsIn,
  monthStart,
  resolveComparison,
  resolvePeriod,
  type Window
} from './period'

type Measure = 'spending' | 'income' | 'net'
type By =
  | 'none'
  | 'month'
  | 'quarter'
  | 'year'
  | 'week'
  | 'weekday'
  | 'category'
  | 'category_group'
  | 'merchant'
  | 'account'
type Split = 'none' | 'category' | 'category_group' | 'merchant' | 'account'
type Group = Exclude<By, 'none'>

const MEASURES: Measure[] = ['spending', 'income', 'net']
const BYS: By[] = [
  'none',
  'month',
  'quarter',
  'year',
  'week',
  'weekday',
  'category',
  'category_group',
  'merchant',
  'account'
]
const SPLITS: Split[] = ['none', 'category', 'category_group', 'merchant', 'account']
const TIME_GRAINS: By[] = ['month', 'quarter', 'year', 'week']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const TOP_GROUPS = 12
const TOP_SPLITS = 8

const SPEND_SQL = 'SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END)'
const INCOME_SQL = 'SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)'

const GROUP_SQL: Record<Group, string> = {
  month: 'month',
  quarter: 'quarter',
  year: 'year',
  week: 'week',
  // strftime('%w') counts from Sunday = 0
  weekday: `CASE strftime('%w', txn_date) ${WEEKDAYS.map((d, i) => `WHEN '${(i + 1) % 7}' THEN '${d}'`).join(' ')} END`,
  category: "COALESCE(category, 'Uncategorized')",
  category_group: "COALESCE(category_group, 'Ungrouped')",
  merchant: "COALESCE(merchant, '(no description)')",
  account: 'account_name'
}

const LABELS: Record<Group, string> = {
  month: 'month',
  quarter: 'quarter',
  year: 'year',
  week: 'week',
  weekday: 'weekday',
  category: 'category',
  category_group: 'category group',
  merchant: 'merchant',
  account: 'account'
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

interface Agg {
  key: string
  sub: string
  spending: number
  income: number
}

interface Plan {
  ctx: AnalysisContext
  measure: Measure
  by: By
  split: Split
  base: TxFilter
  window: Window
  compare: Window | null
  whole: Window | null
}

/** everything computed for one currency */
interface Section {
  columns: string[]
  rows: unknown[][]
  facts: Record<string, unknown>
}

function aggregate(
  p: Plan,
  window: Window,
  currency: string | null,
  group: Group | null,
  sub: Split = 'none'
): Agg[] {
  const where = txWhere({ ...p.base, window, currency })
  const key = group ? GROUP_SQL[group] : "''"
  const subKey = sub === 'none' ? "''" : GROUP_SQL[sub]
  const rows = p.ctx.db
    .prepare(
      `SELECT ${key} AS key, ${subKey} AS sub, ${SPEND_SQL} AS spending, ${INCOME_SQL} AS income
       FROM temp.tx ${where.sql} GROUP BY 1, 2`
    )
    .all(...where.params) as Agg[]
  return rows.map((r) => ({ ...r, key: String(r.key), sub: String(r.sub) }))
}

function valueOf(a: { spending: number; income: number }, m: Measure): number {
  return m === 'spending' ? a.spending : m === 'income' ? a.income : a.income - a.spending
}

function sumAggs(aggs: Agg[]): { spending: number; income: number } {
  return aggs.reduce(
    (t, a) => ({ spending: t.spending + a.spending, income: t.income + a.income }),
    { spending: 0, income: 0 }
  )
}

const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : round2((part / whole) * 100)

/** monthly figures over the window, with empty covered months as zero */
function monthly(p: Plan, currency: string | null): Map<string, Agg> {
  const byMonth = new Map(aggregate(p, p.window, currency, 'month').map((a) => [a.key, a]))
  const data = p.ctx.data
  if (data) {
    for (const m of monthsIn(p.window.start, p.window.end)) {
      if (monthEnd(m) < data.min || monthStart(m) > data.max || byMonth.has(m)) continue
      byMonth.set(m, { key: m, sub: '', spending: 0, income: 0 })
    }
  }
  return new Map([...byMonth].sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** averages, highs and lows over complete months only, plus the month so far */
function monthFacts(p: Plan, currency: string | null): Record<string, unknown> {
  const facts: Record<string, unknown> = {}
  const months = monthly(p, currency)
  const complete = completeMonths(p.window, p.ctx.today, p.ctx.data)
  const values = complete.map((m) => ({
    month: m,
    value: months.has(m) ? valueOf(months.get(m)!, p.measure) : 0
  }))
  if (values.length >= 2) {
    const high = values.reduce((a, b) => (b.value > a.value ? b : a))
    const low = values.reduce((a, b) => (b.value < a.value ? b : a))
    facts.complete_months = values.length
    facts.average_per_complete_month = round2(
      values.reduce((s, v) => s + v.value, 0) / values.length
    )
    facts.highest_complete_month = { month: high.month, [p.measure]: round2(high.value) }
    facts.lowest_complete_month = { month: low.month, [p.measure]: round2(low.value) }
  }
  const current = monthOfDay(p.ctx.today)
  if (p.window.partial && p.window.start < monthStart(current)) {
    const now = months.get(current)
    facts[`${current}_so_far`] = round2(now ? valueOf(now, p.measure) : 0)
  }
  return facts
}

/** net's companions: what went in and out, and the share of income kept */
function netFacts(p: Plan, t: { spending: number; income: number }): Record<string, unknown> {
  if (p.measure !== 'net') return {}
  return {
    total_income: round2(t.income),
    total_spending: round2(t.spending),
    savings_rate_percent: t.income > 0 ? percent(t.income - t.spending, t.income) : null
  }
}

/** top-N by value with the rest folded into one 'Other' entry */
function fold<T extends { name: string }>(items: T[], keep: number, merge: (rest: T[]) => T): T[] {
  if (items.length <= keep + 1) return items
  return [...items.slice(0, keep), merge(items.slice(keep))]
}

function orderKeys(by: Group, entries: { name: string; value: number }[]): string[] {
  if (TIME_GRAINS.includes(by)) return entries.map((e) => e.name).sort()
  if (by === 'weekday')
    return entries.map((e) => e.name).sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
  return [...entries].sort((a, b) => b.value - a.value).map((e) => e.name)
}

/** one row per group of `by`, no comparison */
function grouped(p: Plan, by: Group, currency: string | null): Section {
  const m = p.measure
  const isTime = TIME_GRAINS.includes(by)
  const aggs =
    by === 'month' ? [...monthly(p, currency).values()] : aggregate(p, p.window, currency, by)
  const total = sumAggs(aggs)
  const withNet = m === 'net' && isTime
  const columns = withNet ? [by, 'net', 'income', 'spending'] : [by, m]
  const toRow = (name: string, a: { spending: number; income: number }): unknown[] =>
    withNet
      ? [name, round2(a.income - a.spending), round2(a.income), round2(a.spending)]
      : [name, round2(valueOf(a, m))]

  // an income category has no spending: a zero group is noise, a zero month is not
  const entries = aggs
    .map((a) => ({ name: a.key, value: valueOf(a, m), agg: a }))
    .filter((e) => isTime || e.value !== 0)
  const order = orderKeys(
    by,
    entries.map((e) => ({ name: e.name, value: e.value }))
  )
  let ordered = order.map((name) => entries.find((e) => e.name === name)!)
  if (!isTime && by !== 'weekday')
    ordered = fold(ordered, TOP_GROUPS, (rest) => {
      const agg = sumAggs(rest.map((r) => r.agg))
      return { name: 'Other', value: valueOf(agg, m), agg: { ...agg, key: 'Other', sub: '' } }
    })
  const rows = ordered.map((e) => toRow(e.name, e.agg))

  const facts: Record<string, unknown> = {
    [`total_${m}`]: round2(valueOf(total, m)),
    ...netFacts(p, total)
  }
  if (isTime) Object.assign(facts, monthFacts(p, currency))
  else if (entries.length > 0) {
    // net's top group is just the income, at a share past 100%
    if (m !== 'net') {
      const top = [...entries].sort((a, b) => b.value - a.value)[0]
      facts[`top_${by}`] = {
        name: top.name,
        [m]: round2(top.value),
        share_percent: percent(top.value, valueOf(total, m))
      }
    }
    if (by === 'weekday') {
      const weekend = entries
        .filter((e) => e.name === 'Saturday' || e.name === 'Sunday')
        .reduce((s, e) => s + e.value, 0)
      // two weekend days against five weekdays: a bigger weekday TOTAL read
      // as "spends more on weekdays" even when each weekend day costs more,
      // so the per-day verdict is stated outright and leads the facts
      const perWeekend = weekend / 2
      const perWeekday = (valueOf(total, m) - weekend) / 5
      const higher = perWeekend > perWeekday ? 'weekends' : 'weekdays'
      const lower = Math.min(perWeekend, perWeekday)
      const verdict = {
        more_per_day_on: higher,
        per_weekend_day: round2(perWeekend),
        per_weekday: round2(perWeekday),
        difference_percent: lower === 0 ? null : percent(Math.abs(perWeekend - perWeekday), lower)
      }
      return { columns, rows, facts: { per_day: verdict, ...facts } }
    }
  }
  return { columns, rows, facts }
}

/** long-form rows, one per group of `by` per value of `split` */
function splitRows(p: Plan, by: Group, split: Group, currency: string | null): Section {
  const m = p.measure
  // a net cell whose income and spending cancel still counts toward both totals
  const aggs = aggregate(p, p.window, currency, by, split as Split).filter((a) =>
    m === 'net' ? a.spending !== 0 || a.income !== 0 : valueOf(a, m) !== 0
  )
  const total = sumAggs(aggs)

  const subTotals = new Map<string, number>()
  const keyTotals = new Map<string, number>()
  for (const a of aggs) {
    subTotals.set(a.sub, (subTotals.get(a.sub) ?? 0) + valueOf(a, m))
    keyTotals.set(a.key, (keyTotals.get(a.key) ?? 0) + valueOf(a, m))
  }
  const subRank = [...subTotals].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const keptSubs = new Set(subRank.length > TOP_SPLITS + 1 ? subRank.slice(0, TOP_SPLITS) : subRank)
  let keys = orderKeys(
    by,
    [...keyTotals].map(([name, value]) => ({ name, value }))
  )
  const isBreakdown = !TIME_GRAINS.includes(by) && by !== 'weekday'
  const keptKeys = new Set(
    isBreakdown && keys.length > TOP_GROUPS + 1 ? keys.slice(0, TOP_GROUPS) : keys
  )
  if (keptKeys.size < keys.length) keys = [...keys.filter((k) => keptKeys.has(k)), 'Other']

  const cells = new Map<string, { spending: number; income: number }>()
  for (const a of aggs) {
    const key = keptKeys.has(a.key) ? a.key : 'Other'
    const sub = keptSubs.has(a.sub) ? a.sub : 'Other'
    const id = `${key}\u0000${sub}`
    const cell = cells.get(id) ?? { spending: 0, income: 0 }
    cell.spending += a.spending
    cell.income += a.income
    cells.set(id, cell)
  }
  const subs = keptSubs.size < subRank.length ? [...keptSubs, 'Other'] : [...keptSubs]
  const rows: unknown[][] = []
  for (const key of keys)
    for (const sub of subs) {
      const cell = cells.get(`${key}\u0000${sub}`)
      if (cell) rows.push([key, sub, round2(valueOf(cell, m))])
    }

  const facts: Record<string, unknown> = {
    [`total_${m}`]: round2(valueOf(total, m)),
    ...netFacts(p, total)
  }
  if (TIME_GRAINS.includes(by)) Object.assign(facts, monthFacts(p, currency))
  if (subRank.length > 0 && m !== 'net') {
    const top = subRank[0]
    facts[`top_${split}`] = {
      name: top,
      [m]: round2(subTotals.get(top)!),
      share_percent: percent(subTotals.get(top)!, valueOf(total, m))
    }
  }
  return { columns: [by, split, m], rows, facts }
}

/** base window against the comparison window */
function compared(p: Plan, currency: string | null): Section {
  const m = p.measure
  const prevKey = `previous_${m}`
  const cmp = p.compare!
  const cur = valueOf(sumAggs(aggregate(p, p.window, currency, null)), m)
  const prev = valueOf(sumAggs(aggregate(p, cmp, currency, null)), m)
  const facts: Record<string, unknown> = {
    [`total_${m}`]: round2(cur),
    [`previous_total_${m}`]: round2(prev),
    change: round2(cur - prev),
    change_percent: prev === 0 ? null : round2(((cur - prev) / Math.abs(prev)) * 100)
  }
  if (p.whole)
    facts[`previous_whole_period_total_${m}`] = round2(
      valueOf(sumAggs(aggregate(p, p.whole, currency, null)), m)
    )
  const baseMonths = monthsIn(p.window.start, p.window.end).length
  const cmpMonths = monthsIn(cmp.start, cmp.end).length
  if (baseMonths !== cmpMonths) {
    facts.average_per_month = round2(cur / baseMonths)
    facts.previous_average_per_month = round2(prev / cmpMonths)
  }

  const by = p.by
  if (by === 'none')
    return {
      columns: ['period', m, prevKey, 'change'],
      rows: [[p.window.label, round2(cur), round2(prev), round2(cur - prev)]],
      facts
    }
  if (TIME_GRAINS.includes(by)) {
    const base =
      p.split === 'none' ? grouped(p, by, currency) : splitRows(p, by, p.split as Group, currency)
    return { columns: base.columns, rows: base.rows, facts }
  }

  const now = new Map(aggregate(p, p.window, currency, by).map((a) => [a.key, valueOf(a, m)]))
  const then = new Map(aggregate(p, cmp, currency, by).map((a) => [a.key, valueOf(a, m)]))
  const entries = [...new Set([...now.keys(), ...then.keys()])]
    .map((name) => {
      const a = now.get(name) ?? 0
      const b = then.get(name) ?? 0
      return { name, now: a, then: b, change: a - b }
    })
    .filter((e) => e.now !== 0 || e.then !== 0)
  const byChange = [...entries].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  const totalChange = cur - prev
  facts.drivers = byChange.slice(0, 3).map((e) => ({
    name: e.name,
    change: round2(e.change),
    share_of_change_percent: percent(e.change, totalChange)
  }))
  const ordered =
    by === 'weekday'
      ? [...entries].sort((a, b) => WEEKDAYS.indexOf(a.name) - WEEKDAYS.indexOf(b.name))
      : fold(byChange, TOP_GROUPS, (rest) => {
          const sum = (f: (e: (typeof rest)[number]) => number): number =>
            rest.reduce((s, e) => s + f(e), 0)
          return {
            name: 'Other',
            now: sum((e) => e.now),
            then: sum((e) => e.then),
            change: sum((e) => e.change)
          }
        })
  return {
    columns: [by, m, prevKey, 'change'],
    rows: ordered.map((e) => [e.name, round2(e.now), round2(e.then), round2(e.change)]),
    facts
  }
}

function section(p: Plan, currency: string | null): Section {
  if (p.compare) return compared(p, currency)
  if (p.by === 'none') {
    const total = sumAggs(aggregate(p, p.window, currency, null))
    const value = valueOf(total, p.measure)
    return {
      columns: ['period', p.measure],
      rows: [[p.window.label, round2(value)]],
      facts: {
        [`total_${p.measure}`]: round2(value),
        ...netFacts(p, total),
        ...monthFacts(p, currency)
      }
    }
  }
  return p.split === 'none'
    ? grouped(p, p.by, currency)
    : splitRows(p, p.by, p.split as Group, currency)
}

function currencies(p: Plan): string[] {
  const found = new Set<string>()
  for (const window of [p.window, p.compare].filter((w): w is Window => w !== null)) {
    const where = txWhere({ ...p.base, window })
    const rows = p.ctx.db
      .prepare(`SELECT DISTINCT currency FROM temp.tx ${where.sql}`)
      .all(...where.params) as { currency: string | null }[]
    for (const r of rows) found.add(r.currency ?? '')
  }
  return [...found].sort()
}

const short = (label: string): string => label.replace(/ \(\d+ complete months\)$/, '')

function chartFor(p: Plan, s: Section): ChartSpec | null {
  if (p.by === 'none' || s.rows.length < 2) return null
  const m = p.measure
  const isTime = TIME_GRAINS.includes(p.by)
  const split = p.split === 'none' || (p.compare && !isTime) ? null : p.split
  let title = `${m[0].toUpperCase()}${m.slice(1)} by ${LABELS[p.by as Group]}`
  if (split) title += ` and ${LABELS[split]}`
  if (p.compare && !isTime) title += `, ${short(p.window.label)} vs ${short(p.compare.label)}`
  return {
    type: isTime ? 'line' : 'bar',
    title,
    x: p.by,
    series: p.compare && !isTime ? [m, `previous_${m}`] : [m],
    group: split
  }
}

export function runTotals(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const measure = pick(args.measure, MEASURES, 'spending')
  let by = pick(args.by, BYS, 'none')
  let split = pick(args.split, SPLITS, 'none')
  if (by === 'none' && split !== 'none') [by, split] = [split, 'none']
  if (split === by) split = 'none'

  const period = resolvePeriod(text(args.period) ?? 'this_month', ctx.today, ctx.data)
  if (!period.ok) return fail(period.error, started)
  const window = period.window
  const base: TxFilter = {
    category: text(args.category),
    account: text(args.account),
    search: text(args.search)
  }

  let compare: Window | null = null
  let whole: Window | null = null
  const compareTo = text(args.compare_to)
  // a comparison period the data doesn't cover would read as a huge change,
  // and its figures got quoted even beside a note saying not to; so it isn't
  // computed at all, and the facts say why
  let unavailable: string | null = null
  if (compareTo) {
    const c = resolveComparison(compareTo, window, ctx.today, ctx.data)
    if (!c.ok) return fail(c.error, started)
    const gap = coverageNote(c.window, ctx.data)
    if (gap) unavailable = `${gap} So there is nothing to compare ${window.label} against.`
    else {
      compare = c.window
      whole = c.whole
    }
  }
  // a split inside a breakdown comparison has no row shape that stays readable
  if (compare && !TIME_GRAINS.includes(by)) split = 'none'

  const p: Plan = { ctx, measure, by, split, base, window, compare, whole }
  const notes: string[] = []
  const coverage = coverageNote(window, ctx.data)
  if (coverage) notes.push(coverage)
  const matched = matchedNote(ctx, { ...base, window })
  if (matched) notes.push(matched)
  if (whole && compare)
    notes.push(`Compared over the same days: ${window.label} vs ${compare.label}.`)

  const found = currencies(p)
  if (found.length === 0) {
    if (!coverage && !matched) notes.push(`No matching transactions in ${window.label}.`)
    return {
      result: {
        ok: true,
        period: window.label,
        ...(compare ? { comparedWith: compare.label } : {}),
        facts: {
          ...(unavailable ? { comparison_unavailable: unavailable } : {}),
          [`total_${measure}`]: 0
        },
        notes,
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - started
      },
      chart: null
    }
  }

  let out: Section
  let chart: ChartSpec | null = null
  if (found.length === 1) {
    out = section(p, null)
    if (args.chart === 'auto') chart = chartFor(p, out)
  } else {
    out = { columns: [], rows: [], facts: {} }
    for (const currency of found) {
      const s = section(p, currency)
      out.columns = ['currency', ...s.columns]
      out.rows.push(...s.rows.map((r) => [currency, ...r]))
      for (const [k, v] of Object.entries(s.facts)) out.facts[`${k}_${currency}`] = v
    }
    notes.push('Amounts in different currencies are never added together.')
  }

  return {
    result: {
      ok: true,
      period: window.label,
      ...(compare ? { comparedWith: compare.label } : {}),
      columns: out.columns,
      rows: out.rows,
      rowCount: out.rows.length,
      facts: unavailable ? { comparison_unavailable: unavailable, ...out.facts } : out.facts,
      notes,
      durationMs: Date.now() - started
    },
    chart
  }
}
