// transactions: individual rows, largest or newest first, with the count and
// total of everything that matched so the answer never sums a list itself.
import {
  fail,
  matchedNote,
  round2,
  txWhere,
  type AnalysisContext,
  type ToolOutput,
  type TxFilter
} from './common'
import { coverageNote, resolvePeriod } from './period'

type Direction = 'spending' | 'income' | 'all'

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 10
  return Math.min(25, Math.max(1, value))
}

interface Row {
  txn_date: string
  merchant: string | null
  description: string | null
  category: string | null
  account_name: string
  amount: number
  currency: string
}

export function runTransactions(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const sort = args.sort === 'newest' ? 'newest' : 'largest'
  const direction: Direction =
    args.direction === 'income' || args.direction === 'all' ? args.direction : 'spending'
  const limit = clampLimit(args.limit)

  const period = resolvePeriod(text(args.period) ?? 'all', ctx.today, ctx.data)
  if (!period.ok) return fail(period.error, started)
  const window = period.window
  const filter: TxFilter = {
    window,
    category: text(args.category),
    account: text(args.account),
    search: text(args.search)
  }

  const where = txWhere(filter)
  const sign = direction === 'spending' ? 'amount < 0' : direction === 'income' ? 'amount > 0' : ''
  const whereSql = sign ? (where.sql ? `${where.sql} AND ${sign}` : `WHERE ${sign}`) : where.sql
  const order = sort === 'largest' ? 'ABS(amount) DESC, txn_date DESC' : 'txn_date DESC, id DESC'

  const summary = ctx.db
    .prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
       FROM temp.tx ${whereSql} GROUP BY currency ORDER BY n DESC, currency`
    )
    .all(...where.params) as { currency: string; n: number; total: number }[]
  const rows = ctx.db
    .prepare(
      `SELECT txn_date, merchant, description, category, account_name, amount, currency
       FROM temp.tx ${whereSql} ORDER BY ${order} LIMIT ?`
    )
    .all(...where.params, limit) as Row[]
  const mixed = summary.length > 1

  const facts: Record<string, unknown> = { count: summary.reduce((s, c) => s + c.n, 0) }
  const totalKey =
    direction === 'spending'
      ? 'total_spending'
      : direction === 'income'
        ? 'total_income'
        : 'net_total'
  const shownTotal = (total: number): number =>
    round2(direction === 'spending' ? Math.abs(total) : total)
  if (!mixed) facts[totalKey] = shownTotal(summary[0]?.total ?? 0)
  else for (const c of summary) facts[`${totalKey}_${c.currency}`] = shownTotal(c.total)
  facts.shown = rows.length
  if (sort === 'largest' && limit === 1 && rows[0]) {
    const top = rows[0]
    facts.largest = {
      date: top.txn_date,
      merchant: top.merchant ?? top.description ?? '(no description)',
      // the direction already says which way it went; a signed figure invites a stray minus
      amount: round2(direction === 'all' ? top.amount : Math.abs(top.amount)),
      ...(mixed ? { currency: top.currency } : {})
    }
  }

  const notes = [coverageNote(window, ctx.data), matchedNote(ctx, filter)].filter(
    (n): n is string => n !== null
  )
  if (mixed) notes.push('Amounts in different currencies are never added together.')
  return {
    result: {
      ok: true,
      period: window.label,
      columns: [
        'date',
        'merchant',
        'description',
        'category',
        'account',
        'amount',
        ...(mixed ? ['currency'] : [])
      ],
      rows: rows.map((r) => [
        r.txn_date,
        r.merchant,
        r.description,
        r.category ?? 'Uncategorized',
        r.account_name,
        round2(r.amount),
        ...(mixed ? [r.currency] : [])
      ]),
      rowCount: rows.length,
      facts,
      ...(notes.length ? { notes } : {}),
      durationMs: Date.now() - started
    },
    chart: null
  }
}
