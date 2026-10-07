import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { TransactionsLink } from '@shared/chat'
import { resolveTransactionFilters } from '@shared/transaction-filters'
import { buildWhere } from '../../../reports/filters'
import { scopeViewsDdl } from '../sql-tool'
import { ANALYSIS_RUNNERS, modelView, replayView } from './index'
import { linkRows, MAX_PINNED, windowRange } from './links'
import { addEuroCard, fixtureContext, fixtureDb, noon } from './test-fixture'

const dialect = new SQLiteSyncDialect()

/**
 * What All transactions lists for a filter: the table's own predicate
 * (filteredWhere, unscoped) over the real tables, the temp views dropped so
 * they can't shadow them.
 */
function tableRows(db: DatabaseSync, link: TransactionsLink): number[] {
  const views = ['tx', 'transactions', 'accounts']
  for (const v of views) db.exec(`DROP VIEW IF EXISTS temp.${v}`)
  try {
    const where = buildWhere(resolveTransactionFilters(link.filters, 0), {
      keepUnknownDates: true,
      keepOpeningBalances: true
    })
    const q = dialect.sqlToQuery(where!)
    return (
      db
        .prepare(
          `SELECT transactions.id AS id FROM transactions
           JOIN accounts ON accounts.id = transactions.account_id
           LEFT JOIN categories ON categories.id = transactions.category_id WHERE ${q.sql}`
        )
        .all(...(q.params as never[])) as { id: number }[]
    ).map((r) => r.id)
  } finally {
    for (const ddl of scopeViewsDdl({ accountId: null })) db.exec(ddl)
  }
}

function run(
  name: keyof typeof ANALYSIS_RUNNERS,
  args: Record<string, unknown>,
  db = fixtureDb(),
  accountId: number | null = null
): {
  links: TransactionsLink[]
  db: DatabaseSync
  out: ReturnType<typeof ANALYSIS_RUNNERS.totals>
} {
  if (accountId !== null) for (const ddl of scopeViewsDdl({ accountId })) db.exec(ddl)
  const ctx = { ...fixtureContext(db), accountId }
  const out = ANALYSIS_RUNNERS[name](args, ctx)
  expect(out.result.ok).toBe(true)
  const links = out.links ?? []
  // the chip's N is what the table shows, whichever filter form the link took
  for (const link of links) {
    const listed = tableRows(db, link)
    expect(listed).toHaveLength(link.count)
  }
  return { links, db, out }
}

const totals = (over: Record<string, unknown>): Record<string, unknown> => ({
  measure: 'spending',
  by: 'none',
  split: 'none',
  period: '2026-07',
  compare_to: null,
  category: null,
  account: null,
  search: null,
  chart: 'none',
  ...over
})

const july = windowRange({ start: '2026-07-01', end: '2026-07-31' })

describe('transaction links', () => {
  it('totals links its period as a plain filter', () => {
    const { links } = run('totals', totals({}))
    // rent, power, two subscriptions, four groceries, four coffees, tacos, two Amazon orders
    expect(links).toEqual([
      {
        count: 15,
        filters: {
          dateRange: july,
          direction: 'expense',
          includePending: false,
          includeTransfers: false
        }
      }
    ])
  })

  it('a comparison links both periods, labelled', () => {
    const { links } = run('totals', totals({ compare_to: '2026-06', category: '🍽️ Dining Out' }))
    expect(links.map((l) => [l.label, l.count])).toEqual([
      ['2026-07', 5],
      ['2026-06', 5]
    ])
    expect(links[0].filters.categoryIds).toHaveLength(1)
  })

  it('keeps to the conversation account scope', () => {
    const { links } = run('totals', totals({}), fixtureDb(), 3)
    expect(links[0].count).toBe(13)
    expect(links[0].filters.accountIds).toEqual([3])
  })

  it('transactions links every match, not only the rows listed', () => {
    const { links, out } = run('transactions', {
      sort: 'largest',
      direction: 'spending',
      period: 'all',
      category: null,
      account: null,
      search: 'coffee',
      limit: 3
    })
    expect(out.result.rows).toHaveLength(3)
    expect(links[0].count).toBe(out.result.facts!.count)
    expect(links[0].filters.search).toBe('coffee')
    expect(links[0].filters.transactionIds).toBeUndefined()
  })

  it('pins the rows when the table would also list a starting balance', () => {
    const db = fixtureDb()
    db.exec(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
       VALUES (1, 'manual:opening:1', ${noon('2026-07-03')}, 900000, 'Starting balance', 0, ${noon('2026-07-03')},
         (SELECT id FROM categories WHERE system_key = 'opening'))`
    )
    const { links } = run('totals', totals({ measure: 'income' }), db)
    // the two paychecks, not the starting balance
    expect(links[0].count).toBe(2)
    expect(links[0].filters.transactionIds).toHaveLength(2)
    expect(links[0].filters.dateRange).toEqual(july)
  })

  it('pins the rows when a currency was left out', () => {
    const db = fixtureDb()
    addEuroCard(db, [
      { day: '2026-05-04', amount: -30, description: 'CAFE DE FLORE', category: '🍽️ Dining Out' }
    ])
    const { links } = run(
      'what_if',
      {
        category: '🍽️ Dining Out',
        search: null,
        change_percent: -50,
        change_per_month: null,
        goal: null
      },
      db
    )
    // six complete months of four coffees and a taco night, the euro charge left out
    expect(links[0].count).toBe(30)
    expect(links[0].filters.transactionIds).toHaveLength(30)
  })

  it('budgets links the budgeted spending, pending included', () => {
    const { links } = run('budgets', { month: '2026-08', chart: 'none' })
    expect(links[0].count).toBe(9)
    expect(links[0].filters.includePending).toBe(true)
    expect(links[0].filters.categoryIds).toHaveLength(2)
  })

  it('recurring pins the charges each cadence was read from', () => {
    const { links, out } = run('recurring', { kind: 'all', chart: 'none' })
    expect(out.result.rowCount).toBeGreaterThan(0)
    expect(links[0].filters.transactionIds).toHaveLength(links[0].count)
  })

  it('unusual pins the flagged charges', () => {
    const { links, db } = run('unusual', { period: '2026-09' })
    const flagged = (
      db
        .prepare(
          `SELECT description FROM main.transactions WHERE id IN (${links[0].filters.transactionIds!.join(',')})`
        )
        .all() as { description: string }[]
    ).map((r) => r.description)
    expect(flagged).toEqual(expect.arrayContaining(['SQ *TACOS EL GORDO', 'REI #45 BERKELEY']))
  })

  it('goals and balances link nothing', () => {
    expect(run('goals', { goal: null, view: 'status', chart: 'none' }).links).toEqual([])
    expect(run('balances', { account: null, chart: 'none' }).links).toEqual([])
  })

  it('links nothing rather than pin more rows than a filter can carry', () => {
    const ctx = fixtureContext()
    const ids = Array.from({ length: MAX_PINNED + 1 }, (_, i) => i + 1)
    expect(
      linkRows(ctx, ids, {
        dateRange: { kind: 'all' },
        direction: 'all',
        includePending: true,
        includeTransfers: true
      })
    ).toBeNull()
  })

  it('a failing link never fails the answer', () => {
    const ctx = fixtureContext()
    const db = ctx.db
    const broken = {
      ...ctx,
      db: {
        prepare: (sql: string) => {
          if (sql.includes('main.transactions')) throw new Error('boom')
          return db.prepare(sql)
        }
      }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = ANALYSIS_RUNNERS.totals(totals({}), broken)
    warn.mockRestore()
    expect(out.result.ok).toBe(true)
    expect(out.links).toEqual([])
  })

  it('never reaches the model', () => {
    const { out } = run('totals', totals({}))
    for (const view of [modelView(out.result), replayView(out.result)])
      expect(JSON.stringify(view)).not.toMatch(/dateRange|transactionIds|links/)
  })
})
