import type { SfinAccountSet } from '../simplefin'

// Deterministic building blocks for the sample datasets. Every random draw is
// keyed by (dataset, day, stream), so the same day always yields the same
// transactions no matter how far back a generation starts. That is what keeps
// a re-sync against the demo bridge an idempotent upsert.

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32: small, fast, and good enough for plausible sample data */
export function random(seed: string): () => number {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Day {
  /** local noon, unix seconds (the import convention for date-only rows) */
  posted: number
  year: number
  /** 1-12 */
  month: number
  date: number
  /** 0 = Sunday */
  weekday: number
  daysInMonth: number
  /** 'YYYYMMDD', the stable part of every transaction id */
  key: string
}

export function dayAt(base: Date, offset: number): Day {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, 12)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const date = d.getDate()
  return {
    posted: Math.floor(d.getTime() / 1000),
    year,
    month,
    date,
    weekday: d.getDay(),
    daysInMonth: new Date(year, month, 0).getDate(),
    key: `${year}${String(month).padStart(2, '0')}${String(date).padStart(2, '0')}`
  }
}

/** 'YYYY-MM' of the month `offset` months from `base` */
export function monthKey(base: Date, offset = 0): string {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function cents(rng: () => number, min: number, max: number): number {
  return Math.round((min + rng() * (max - min)) * 100)
}

const decimal = (amountCents: number): string => (amountCents / 100).toFixed(2)

interface DraftTransaction {
  day: Day
  slug: string
  description: string
  /** signed, in cents */
  amount: number
}

/** Collects one SimpleFIN account's transactions, then renders the payload shape. */
export class AccountDraft {
  readonly transactions: DraftTransaction[] = []

  constructor(
    readonly id: string,
    readonly name: string,
    readonly connId: string,
    /** balance before the first generated transaction, in cents */
    readonly opening: number
  ) {}

  add(day: Day, slug: string, description: string, amount: number): void {
    this.transactions.push({ day, slug, description, amount })
  }

  /** sum of transactions whose day key falls in [from, to], in cents */
  total(from: string, to: string, filter: (t: DraftTransaction) => boolean = () => true): number {
    return this.transactions
      .filter((t) => t.day.key >= from && t.day.key <= to && filter(t))
      .reduce((sum, t) => sum + t.amount, 0)
  }

  render(
    now: Date,
    options: { pendingAfter?: string; balance?: number; holdings?: SfinHoldingDraft[] } = {}
  ): SfinAccountSet['accounts'][number] {
    const balance = options.balance ?? this.opening + this.total('0', '99999999')
    const seen = new Map<string, number>()
    return {
      id: this.id,
      name: this.name,
      conn_id: this.connId,
      currency: 'USD',
      balance: decimal(balance),
      'balance-date': Math.floor(now.getTime() / 1000),
      transactions: this.transactions.map((t) => {
        const base = `${this.id}-${t.day.key}-${t.slug}`
        const n = (seen.get(base) ?? 0) + 1
        seen.set(base, n)
        // only swipes wait to post; payments and deposits land settled
        const pending =
          options.pendingAfter !== undefined && t.day.key > options.pendingAfter && t.amount < 0
        return {
          id: `${base}-${n}`,
          posted: t.day.posted,
          amount: decimal(t.amount),
          description: t.description,
          ...(pending ? { pending: true } : {})
        }
      }),
      holdings: (options.holdings ?? []).map((h) => ({
        id: `${this.id}-${h.symbol}`,
        symbol: h.symbol,
        description: h.description,
        currency: 'USD',
        shares: h.shares.toFixed(4),
        market_value: decimal(h.marketValue),
        cost_basis: decimal(h.costBasis),
        purchase_price: decimal(Math.round(h.costBasis / h.shares)),
        created: h.created
      }))
    }
  }
}

export interface SfinHoldingDraft {
  symbol: string
  description: string
  shares: number
  /** cents */
  marketValue: number
  /** cents */
  costBasis: number
  created: number
}
