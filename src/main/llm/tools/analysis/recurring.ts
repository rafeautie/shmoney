// Recurring charges found in the spending itself: a merchant charging about
// the same amount on a steady monthly, quarterly or annual beat. Weekly and
// irregular merchants are habits, and everyday categories are left out, since
// a monthly taco night is not a bill.
import type { ChartSpec } from '@shared/chat'
import { round2, type AnalysisContext, type ToolOutput } from './common'
import { daysBetween, monthOfDay, monthStart, shiftMonth, ymd } from './period'

export type Cadence = 'monthly' | 'quarterly' | 'annual'

export interface PriceChange {
  from: number
  to: number
  /** the first charge at the new price */
  on: string
}

export interface RecurringCharge {
  merchant: string
  category: string | null
  kind: 'subscription' | 'bill'
  cadence: Cadence
  /** positive major units */
  typicalAmount: number
  monthlyCost: number
  lastCharged: string
  nextExpected: string
  priceChange: PriceChange | null
}

const EVERYDAY = /grocer|dining|restaurant|food|coffee|shopping|gas|fuel|transport/i
const BILL = /rent|mortgage|housing|utilit|insurance|loan|phone|internet|debt/i

const CADENCES: { cadence: Cadence; min: number; max: number; days: number; months: number }[] = [
  { cadence: 'monthly', min: 26, max: 35, days: 30.44, months: 1 },
  { cadence: 'quarterly', min: 85, max: 95, days: 91.31, months: 3 },
  { cadence: 'annual', min: 350, max: 380, days: 365.25, months: 12 }
]

const MIN_CHARGES = 3
const MIN_IN_BAND = 0.7
const MAX_CV = 0.35

interface Charge {
  date: string
  amount: number
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** a real price move rather than rounding or tax noise */
const differs = (a: number, b: number): boolean =>
  Math.abs(a - b) > 0.5 && Math.abs(a - b) > 0.02 * Math.abs(b)

function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const last = Number(ymd(y, m + n + 1, 0).slice(8))
  return ymd(y, m + n, Math.min(d, last))
}

function cadenceOf(charges: Charge[]): (typeof CADENCES)[number] | null {
  const gaps = charges.slice(1).map((c, i) => daysBetween(charges[i].date, c.date))
  const band = CADENCES.find((c) => {
    const g = median(gaps)
    return g >= c.min && g <= c.max
  })
  if (!band) return null
  const inBand = gaps.filter((g) => g >= band.min && g <= band.max).length
  return inBand / gaps.length >= MIN_IN_BAND ? band : null
}

/** a charge in most periods is a habit's signature, not a subscription's */
function chargesMoreThanOncePerPeriod(charges: Charge[], months: number): boolean {
  const perPeriod = new Map<string, number>()
  for (const c of charges) {
    const [y, m] = c.date.split('-').map(Number)
    const key = `${y}-${Math.floor((m - 1) / months)}`
    perPeriod.set(key, (perPeriod.get(key) ?? 0) + 1)
  }
  const crowded = [...perPeriod.values()].filter((n) => n > 1).length
  return crowded > perPeriod.size / 2
}

/**
 * The most recent step: the latest price, held back to where it started, set
 * against a price that itself held for 2+ charges. A bill that varies every
 * month (utilities) has no held price, so it never reports a change.
 */
function priceChangeOf(charges: Charge[]): PriceChange | null {
  const amounts = charges.map((c) => c.amount)
  const to = amounts[amounts.length - 1]
  let i = amounts.length - 1
  while (i > 0 && !differs(amounts[i - 1], to)) i--
  if (i < 2) return null
  const from = amounts[i - 1]
  if (differs(amounts[i - 2], from)) return null
  return { from: round2(from), to: round2(to), on: charges[i].date }
}

export function detectRecurring(ctx: AnalysisContext): RecurringCharge[] {
  const current = monthOfDay(ctx.today)
  const since = monthStart(shiftMonth(current, -12))
  // annual needs a second year to see even two charges
  const annualSince = monthStart(shiftMonth(current, -24))
  const rows = ctx.db
    .prepare(
      `SELECT merchant, category, txn_date, -amount AS amount FROM temp.tx
       WHERE amount < 0 AND merchant IS NOT NULL AND txn_date >= ? AND txn_date <= ?
       ORDER BY merchant, txn_date, id`
    )
    .all(annualSince, ctx.today) as {
    merchant: string
    category: string | null
    txn_date: string
    amount: number
  }[]

  const byMerchant = new Map<string, { category: string | null; charges: Charge[] }>()
  for (const r of rows) {
    const entry = byMerchant.get(r.merchant) ?? { category: null, charges: [] }
    entry.category = r.category
    entry.charges.push({ date: r.txn_date, amount: r.amount })
    byMerchant.set(r.merchant, entry)
  }

  const found: RecurringCharge[] = []
  for (const [merchant, { category, charges: all }] of byMerchant) {
    if (category && EVERYDAY.test(category)) continue
    const recent = all.filter((c) => c.date >= since)
    let band = recent.length >= MIN_CHARGES ? cadenceOf(recent) : null
    let charges = recent
    if (band?.cadence === 'annual') band = null
    if (!band && all.length >= 2) {
      const annual = cadenceOf(all)
      if (annual?.cadence === 'annual') {
        band = annual
        charges = all
      }
    }
    if (!band) continue
    if (chargesMoreThanOncePerPeriod(charges, band.months)) continue

    const amounts = charges.map((c) => c.amount)
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
    const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length)
    if (mean <= 0 || sd / mean > MAX_CV) continue

    const last = charges[charges.length - 1].date
    if (daysBetween(last, ctx.today) > 1.5 * band.days) continue

    const typical = round2(median(amounts.slice(-3)))
    found.push({
      merchant,
      category,
      kind: category && BILL.test(category) ? 'bill' : 'subscription',
      cadence: band.cadence,
      typicalAmount: typical,
      monthlyCost: round2(typical / band.months),
      lastCharged: last,
      nextExpected: addMonths(last, band.months),
      priceChange: priceChangeOf(charges)
    })
  }
  return found.sort((a, b) => b.monthlyCost - a.monthlyCost)
}

export function runRecurring(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const kind = args.kind === 'subscriptions' || args.kind === 'bills' ? args.kind : 'all'
  const all = detectRecurring(ctx)
  const charges = all.filter(
    (c) =>
      kind === 'all' ||
      (kind === 'subscriptions' && c.kind === 'subscription') ||
      (kind === 'bills' && c.kind === 'bill')
  )

  const columns = [
    'merchant',
    'category',
    'kind',
    'cadence',
    'typical_amount',
    'monthly_cost',
    'last_charged',
    'next_expected',
    'price_change'
  ]
  const rows = charges.map((c) => [
    c.merchant,
    c.category,
    c.kind,
    c.cadence,
    c.typicalAmount,
    c.monthlyCost,
    c.lastCharged,
    c.nextExpected,
    c.priceChange ? `${c.priceChange.from} to ${c.priceChange.to} on ${c.priceChange.on}` : null
  ])

  const sum = (xs: RecurringCharge[]): number => round2(xs.reduce((s, c) => s + c.monthlyCost, 0))
  const facts: Record<string, unknown> = { count: charges.length, monthly_total: sum(charges) }
  if (kind === 'all') {
    facts.subscriptions_monthly = sum(charges.filter((c) => c.kind === 'subscription'))
    facts.bills_monthly = sum(charges.filter((c) => c.kind === 'bill'))
  }
  if (charges.length > 0)
    facts.largest = { merchant: charges[0].merchant, monthly_cost: charges[0].monthlyCost }
  const increases = charges.filter((c) => c.priceChange && c.priceChange.to > c.priceChange.from)
  if (increases.length > 0) facts.price_increases = increases.map((c) => c.merchant)

  const what = kind === 'all' ? 'recurring charges' : kind
  const notes: string[] = []
  if (charges.length === 0) notes.push(`No ${what} found in the last 13 months of spending.`)
  if (charges.some((c) => c.cadence !== 'monthly'))
    notes.push('monthly_cost spreads quarterly and annual charges over the months between them.')

  const chart: ChartSpec | null =
    args.chart !== 'none' && rows.length >= 2
      ? {
          type: 'bar',
          title: 'Recurring charges per month',
          x: 'merchant',
          series: ['monthly_cost'],
          group: null
        }
      : null

  return {
    result: {
      ok: true,
      period: `${monthStart(shiftMonth(monthOfDay(ctx.today), -12))} to ${ctx.today}`,
      columns,
      rows,
      rowCount: rows.length,
      facts,
      notes,
      durationMs: Date.now() - started
    },
    chart
  }
}
