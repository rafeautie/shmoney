// Things worth a look in a period, each a flag row the answer can list:
// duplicate charges, new merchants, price changes, categories above their usual
// pace, outsized charges and goals falling behind. A charge carries at most one
// flag, so a duplicate isn't also counted as a large charge.
import { GOAL_STATUS_LABELS } from '@shared/goals'
import { fail, round2, type AnalysisContext, type ToolOutput } from './common'
import {
  addDays,
  completeMonths,
  daysBetween,
  monthEnd,
  monthOfDay,
  monthStart,
  monthsIn,
  resolvePeriod,
  shiftMonth,
  type Window
} from './period'
import { detectRecurring } from './recurring'

type FlagKind =
  | 'possible duplicate'
  | 'new merchant'
  | 'price change'
  | 'above usual pace'
  | 'large charge'
  | 'goal behind'

interface Flag {
  kind: FlagKind
  date: string
  merchant: string
  amount: number | null
  detail: string
  /** the transaction behind a charge-level flag */
  txId: number | null
}

interface Spend {
  id: number
  txn_date: string
  merchant: string | null
  category: string | null
  amount: number
}

const DUPLICATE_DAYS = 3
const NEW_MERCHANT_MIN = 20
// the data's first weeks make every merchant look new
const NEW_MERCHANT_WARMUP_DAYS = 60
const PACE_RATIO = 1.5
const PACE_MIN_OVER = 50
const PACE_MONTHS = 6
const LARGE_MIN = 100
const LARGE_RATIO = 3

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function spendBetween(ctx: AnalysisContext, start: string, end: string): Spend[] {
  return ctx.db
    .prepare(
      `SELECT id, txn_date, merchant, category, -amount AS amount FROM temp.tx
       WHERE amount < 0 AND txn_date BETWEEN ? AND ? ORDER BY txn_date, id`
    )
    .all(start, end) as Spend[]
}

function duplicates(ctx: AnalysisContext, w: Window): Flag[] {
  const rows = spendBetween(ctx, addDays(w.start, -DUPLICATE_DAYS), addDays(w.end, DUPLICATE_DAYS))
  const lastSeen = new Map<string, Spend>()
  const flags: Flag[] = []
  for (const t of rows) {
    if (!t.merchant) continue
    const key = `${t.merchant}\u0000${t.amount}`
    const prev = lastSeen.get(key)
    lastSeen.set(key, t)
    if (!prev || daysBetween(prev.txn_date, t.txn_date) > DUPLICATE_DAYS) continue
    const inWindow = (d: string): boolean => d >= w.start && d <= w.end
    // flag whichever charge of the pair falls in the window
    const [flagged, other] = inWindow(t.txn_date) ? [t, prev] : [prev, t]
    if (!inWindow(flagged.txn_date)) continue
    flags.push({
      kind: 'possible duplicate',
      date: flagged.txn_date,
      merchant: t.merchant,
      amount: round2(flagged.amount),
      detail: `Same amount also charged on ${other.txn_date}.`,
      txId: flagged.id
    })
  }
  return flags
}

function newMerchants(ctx: AnalysisContext, w: Window): Flag[] {
  if (!ctx.data) return []
  const from = [w.start, addDays(ctx.data.min, NEW_MERCHANT_WARMUP_DAYS)].sort()[1]
  const firsts = ctx.db
    .prepare(
      `SELECT id, txn_date, merchant, -amount AS amount FROM temp.tx
       WHERE amount < 0 AND merchant IS NOT NULL AND txn_date <= ? ORDER BY txn_date, id`
    )
    .all(w.end) as (Spend & { merchant: string })[]
  const seen = new Set<string>()
  const flags: Flag[] = []
  for (const t of firsts) {
    if (seen.has(t.merchant)) continue
    seen.add(t.merchant)
    if (t.txn_date < from || t.amount < NEW_MERCHANT_MIN) continue
    flags.push({
      kind: 'new merchant',
      date: t.txn_date,
      merchant: t.merchant,
      amount: round2(t.amount),
      detail: 'First charge from this merchant.',
      txId: t.id
    })
  }
  return flags
}

function priceChanges(ctx: AnalysisContext, w: Window): Flag[] {
  return detectRecurring(ctx).flatMap((c) =>
    c.priceChange && c.priceChange.on >= w.start && c.priceChange.on <= w.end
      ? [
          {
            kind: 'price change' as const,
            date: c.priceChange.on,
            merchant: c.merchant,
            amount: c.priceChange.to,
            detail: `Price went from ${c.priceChange.from} to ${c.priceChange.to}.`,
            txId: null
          }
        ]
      : []
  )
}

/**
 * Each category's spending in the window against its median over the complete
 * months before it. A partial month is set against the same first days of
 * those months; a longer window against the median month scaled to its length.
 */
function abovePace(ctx: AnalysisContext, w: Window): Flag[] {
  const first = monthOfDay(w.start)
  const span = {
    start: monthStart(shiftMonth(first, -PACE_MONTHS)),
    end: monthEnd(shiftMonth(first, -1)),
    label: '',
    partial: false
  }
  const baseline = completeMonths(span, ctx.today, ctx.data)
  if (baseline.length < 3) return []

  const months = monthsIn(w.start, w.end)
  const oneMonth = months.length === 1
  const days = daysBetween(w.start, w.end) + 1
  const scale = oneMonth ? 1 : days / 30.44
  const sameDays = oneMonth && w.partial
  const sumByCategory = (rows: Spend[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const key = r.category ?? 'Uncategorized'
      m.set(key, (m.get(key) ?? 0) + r.amount)
    }
    return m
  }

  const current = sumByCategory(spendBetween(ctx, w.start, w.end))
  const past = baseline.map((m) => {
    const cut = addDays(monthStart(m), days - 1)
    const end = sameDays && cut < monthEnd(m) ? cut : monthEnd(m)
    return sumByCategory(spendBetween(ctx, monthStart(m), end))
  })

  const flags: Flag[] = []
  for (const [category, spent] of current) {
    // recent charges are often not categorized yet, so their "pace" is noise
    if (category === 'Uncategorized') continue
    const usual = median(past.map((p) => p.get(category) ?? 0)) * scale
    if (spent > PACE_RATIO * usual && spent - usual >= PACE_MIN_OVER) {
      const basis = sameDays
        ? `median of the first ${days} days of the last ${baseline.length} complete months`
        : oneMonth
          ? `median of the last ${baseline.length} complete months`
          : `median month of the ${baseline.length} complete months before, scaled to ${days} days`
      flags.push({
        kind: 'above usual pace',
        date: w.end,
        merchant: category,
        amount: round2(spent),
        detail: `Spent ${round2(spent)} against a usual ${round2(usual)} (${basis}).`,
        txId: null
      })
    }
  }
  return flags
}

function largeCharges(ctx: AnalysisContext, w: Window): Flag[] {
  const byCategory = new Map<string | null, Spend[]>()
  for (const t of spendBetween(ctx, addDays(w.start, -365), w.end)) {
    const list = byCategory.get(t.category) ?? []
    list.push(t)
    byCategory.set(t.category, list)
  }
  const flags: Flag[] = []
  for (const [category, rows] of byCategory)
    for (const t of rows) {
      if (t.txn_date < w.start || t.amount < LARGE_MIN) continue
      const from = addDays(t.txn_date, -365)
      const others = rows
        .filter((o) => o.id !== t.id && o.txn_date >= from && o.txn_date <= t.txn_date)
        .map((o) => o.amount)
      if (others.length < 3) continue
      const usual = median(others)
      if (t.amount > LARGE_RATIO * usual)
        flags.push({
          kind: 'large charge',
          date: t.txn_date,
          merchant: t.merchant ?? '(no description)',
          amount: round2(t.amount),
          detail: `About ${Math.round((t.amount / usual) * 10) / 10} times the usual ${category ?? 'Uncategorized'} charge of ${round2(usual)}.`,
          txId: t.id
        })
    }
  return flags
}

function goalsBehind(ctx: AnalysisContext, w: Window): Flag[] {
  // a goal's status is as of today, so it only belongs to a window reaching today
  if (!w.partial) return []
  const rows = ctx.db
    .prepare(
      `SELECT name, status, needed_per_month, average_per_month FROM temp.goals
       WHERE status IN (?, ?) ORDER BY name`
    )
    .all(GOAL_STATUS_LABELS.behind, GOAL_STATUS_LABELS.overdue) as {
    name: string
    status: string
    needed_per_month: number | null
    average_per_month: number | null
  }[]
  return rows.map((g) => ({
    kind: 'goal behind',
    date: w.end,
    merchant: g.name,
    amount: null,
    detail:
      g.needed_per_month != null && g.average_per_month != null
        ? `${g.status}: needs ${round2(g.needed_per_month)} a month, saving ${round2(g.average_per_month)} a month.`
        : `${g.status}.`,
    txId: null
  }))
}

export function runUnusual(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const spec = typeof args.period === 'string' && args.period.trim() ? args.period : 'this_month'
  const period = resolvePeriod(spec, ctx.today, ctx.data)
  if (!period.ok) return fail(period.error, started)
  const w = period.window

  // earlier kinds win when one charge qualifies twice
  const flagged = new Set<number>()
  const flags: Flag[] = []
  for (const batch of [
    duplicates(ctx, w),
    newMerchants(ctx, w),
    largeCharges(ctx, w),
    priceChanges(ctx, w),
    abovePace(ctx, w),
    goalsBehind(ctx, w)
  ])
    for (const f of batch) {
      if (f.txId != null) {
        if (flagged.has(f.txId)) continue
        flagged.add(f.txId)
      }
      flags.push(f)
    }
  flags.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const byKind: Record<string, number> = {}
  for (const f of flags) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
  const inWindow = (f: Flag): boolean => f.date >= w.start && f.date <= w.end
  const totalFlagged = round2(
    flags.reduce(
      (s, f) => s + (f.txId != null && f.amount != null && inWindow(f) ? f.amount : 0),
      0
    )
  )

  return {
    result: {
      ok: true,
      period: w.label,
      columns: ['kind', 'date', 'merchant', 'amount', 'detail'],
      rows: flags.map((f) => [f.kind, f.date, f.merchant, f.amount, f.detail]),
      rowCount: flags.length,
      facts: { flags: flags.length, by_kind: byKind, total_flagged_spending: totalFlagged },
      notes: flags.length === 0 ? [`Nothing unusual in ${w.label}.`] : [],
      durationMs: Date.now() - started
    },
    chart: null
  }
}
