import type { ChartSpec } from '@shared/chat'
import { fail, round2, type AnalysisContext, type ToolOutput } from './common'
import { addDays } from './period'

interface AccountRow {
  id: number
  name: string
  currency: string
  balance: number
  change: number
}

function totals(accounts: AccountRow[]): Record<string, number> {
  const assets = accounts.filter((a) => a.balance >= 0).reduce((s, a) => s + a.balance, 0)
  const debts = accounts.filter((a) => a.balance < 0).reduce((s, a) => s - a.balance, 0)
  return {
    net_worth: round2(assets - debts),
    assets: round2(assets),
    debts: round2(debts),
    accounts: accounts.length
  }
}

export function runBalances(args: Record<string, unknown>, ctx: AnalysisContext): ToolOutput {
  const started = Date.now()
  const name = typeof args.account === 'string' && args.account.trim() ? args.account.trim() : null

  const all = ctx.db
    .prepare(
      'SELECT a.id, a.name, a.currency, a.balance, ' +
        '(SELECT COALESCE(SUM(t.amount), 0) FROM temp.transactions t WHERE t.account_id = a.id ' +
        'AND t.pending = 0 AND t.txn_date BETWEEN ? AND ?) AS change ' +
        'FROM temp.accounts a ORDER BY a.id'
    )
    .all(addDays(ctx.today, -29), ctx.today) as AccountRow[]
  if (all.length === 0)
    return {
      result: { ok: true, notes: ['There are no accounts yet.'], durationMs: Date.now() - started },
      chart: null
    }
  const accounts = name ? all.filter((a) => a.name.toLowerCase() === name.toLowerCase()) : all
  if (accounts.length === 0)
    return fail(
      `No account named '${name}'. The accounts are: ${all.map((a) => a.name).join(', ')}.`,
      started
    )

  const goals = ctx.db.prepare('SELECT name, accounts FROM temp.goals ORDER BY id').all() as {
    name: string
    accounts: string | null
  }[]
  const funds = (account: string): string | null => {
    const names = goals
      .filter((g) => (g.accounts ?? '').split(',').some((a) => a.trim() === account))
      .map((g) => g.name)
    return names.length ? names.join(', ') : null
  }

  const currencies = [...new Set(accounts.map((a) => a.currency))]
  const mixed = currencies.length > 1
  const columns = ['account', 'balance', 'kind', 'change_30d', 'funds_goals']
  if (mixed) columns.splice(2, 0, 'currency')
  const rows = accounts.map((a) => {
    const row: unknown[] = [
      a.name,
      round2(a.balance),
      a.balance < 0 ? 'debt' : 'asset',
      round2(a.change),
      funds(a.name)
    ]
    if (mixed) row.splice(2, 0, a.currency)
    return row
  })

  const notes: string[] = []
  let facts: Record<string, unknown>
  if (accounts.length === 1) {
    const a = accounts[0]
    facts = {
      account: a.name,
      balance: round2(a.balance),
      kind: a.balance < 0 ? 'debt' : 'asset',
      change_30d: round2(a.change),
      funds_goals: funds(a.name)
    }
  } else if (mixed) {
    facts = Object.fromEntries(
      currencies.map((c) => [c, totals(accounts.filter((a) => a.currency === c))])
    )
    notes.push(
      `The accounts are in ${currencies.join(' and ')}; totals are per currency and never added together.`
    )
  } else {
    facts = totals(accounts)
  }

  const chart: ChartSpec | null =
    args.chart !== 'none' && accounts.length >= 2 && !mixed
      ? { type: 'bar', title: 'Account balances', x: 'account', series: ['balance'], group: null }
      : null
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
    chart
  }
}
