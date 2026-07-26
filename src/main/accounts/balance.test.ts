import { describe, it, expect } from 'vitest'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { balanceDeltaWhere, withDerivedBalance } from './balance'

// better-sqlite3 is built for Electron's ABI and won't load under vitest, so
// the predicate is asserted as generated SQL here; that the numbers come out
// right end to end is covered by the chat scope views, which run real SQL
// against the real migrations (llm/tools/scope-views.test.ts).
const dialect = new SQLiteSyncDialect()
function where(ids?: number[]): { sql: string; params: unknown[] } {
  const { sql, params } = dialect.sqlToQuery(balanceDeltaWhere(ids)!)
  return { sql: sql.toLowerCase(), params }
}

describe('balanceDeltaWhere', () => {
  it('counts only transactions after the account anchor', () => {
    // strictly greater: a transaction dated at the anchor is already in it
    expect(where().sql).toContain('> "accounts"."balance_date"')
  })

  it('uses the shared effective-date expression, not posted alone', () => {
    const { sql } = where()
    expect(sql).toContain('coalesce(nullif("transactions"."posted", 0)')
    expect(sql).toContain('"transactions"."transacted_at"')
  })

  it('excludes soft-deleted rows', () => {
    expect(where().sql).toContain('"transactions"."deleted_at" is null')
  })

  it('excludes pending rows, which a bank’s current balance also excludes', () => {
    const { sql, params } = where()
    expect(sql).toContain('"transactions"."pending" = ?')
    expect(params).toContain(0)
  })

  it('scopes to the given accounts, and to all of them when none are given', () => {
    expect(where([7, 9]).sql).toContain('in (?, ?)')
    expect(where([7, 9]).params).toEqual(expect.arrayContaining([7, 9]))
    expect(where().sql).not.toContain('"transactions"."account_id" in')
  })
})

describe('withDerivedBalance', () => {
  const cases = [
    // a synced account right after a sync: nothing is newer than the anchor
    { name: 'synced, no activity since sync', anchor: 250_000, delta: 0, expected: 250_000 },
    {
      name: 'synced, a transaction added since',
      anchor: 250_000,
      delta: -5_000,
      expected: 245_000
    },
    // manual accounts anchor at the epoch, so the anchor is an opening balance
    { name: 'manual opening balance', anchor: 100_000, delta: 42_500, expected: 142_500 },
    { name: 'manual with no opening balance', anchor: 0, delta: 42_500, expected: 42_500 },
    // a liability: spending has to make the balance MORE negative. This is the
    // shape that was wrong while invert_balance applied a flip at read time.
    { name: 'credit card, purchase', anchor: -1_500_000, delta: -50_000, expected: -1_550_000 },
    { name: 'credit card, payment', anchor: -1_500_000, delta: 200_000, expected: -1_300_000 }
  ]

  it.each(cases)('$name', ({ anchor, delta, expected }) => {
    expect(withDerivedBalance({ balance: anchor }, delta).balance).toBe(expected)
  })

  it('exposes the untouched anchor as reportedBalance', () => {
    const row = withDerivedBalance({ balance: 250_000, availableBalance: 240_000 }, -5_000)
    expect(row).toEqual({ balance: 245_000, reportedBalance: 250_000, availableBalance: 240_000 })
  })
})
