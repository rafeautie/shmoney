import { describe, it, expect } from 'vitest'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { buildWhere } from './filters'
import { DEFAULT_TRANSACTION_FILTERS } from '@shared/transaction-filters'
import { resolveTransactionFilters } from '@shared/transaction-filters'

// better-sqlite3 won't load under vitest, so the predicate is asserted as
// generated SQL and its bound params. That the exclusion produces the right
// numbers is covered by the chat scope views, which run real SQL against the
// real migrations (llm/tools/scope-views.test.ts).
const dialect = new SQLiteSyncDialect()
const FILTERS = resolveTransactionFilters(DEFAULT_TRANSACTION_FILTERS, 0)

function compile(opts?: Parameters<typeof buildWhere>[1]): { sql: string; params: unknown[] } {
  const { sql, params } = dialect.sqlToQuery(buildWhere(FILTERS, opts)!)
  return { sql: sql.toLowerCase(), params }
}

describe('buildWhere and starting balances', () => {
  it('drops them by default, so no report counts one as income', () => {
    expect(compile().params).toContain('opening')
  })

  it('keeps them when the caller asks, so the account ledger adds up', () => {
    // the transactions table opts out explicitly, the same way it opts out of
    // the unknown-date filter
    const { params } = compile({ keepUnknownDates: true, keepOpeningBalances: true })
    expect(params).not.toContain('opening')
  })

  it('excludes them NULL-safely, so uncategorized rows still pass', () => {
    // `<>` alone would drop every uncategorized row, since NULL <> x is NULL
    expect(compile().sql).toContain('"category_id" is null or')
  })

  it('is independent of the transfers filter', () => {
    // DEFAULT_TRANSACTION_FILTERS is the table's, which opts transfers in;
    // reports default them out
    const withTransfers = dialect.sqlToQuery(buildWhere(FILTERS)!)
    const withoutTransfers = dialect.sqlToQuery(
      buildWhere({ ...FILTERS, includeTransfers: false })!
    )
    expect(withTransfers.params).not.toContain('transfers')
    expect(withoutTransfers.params).toContain('transfers')
    // either way, opening balances stay out — opting into transfers must not
    // drag them back in
    expect(withTransfers.params).toContain('opening')
    expect(withoutTransfers.params).toContain('opening')
  })
})

describe('description phrases', () => {
  const withPhrases = (descriptionSearch: string[]): { sql: string; params: unknown[] } => {
    const { sql, params } = dialect.sqlToQuery(buildWhere({ ...FILTERS, descriptionSearch })!)
    return { sql: sql.toLowerCase(), params }
  }

  it('ORs the phrases, so a widget can chart several merchants at once', () => {
    const { sql, params } = withPhrases(['costco', 'safeway'])
    // parenthesized as its own group: bare ORs would swallow every other predicate
    expect(sql).toContain(
      '("transactions"."description" like ? escape \'\\\' or "transactions"."description" like ? escape \'\\\')'
    )
    expect(params).toContain('%costco%')
    expect(params).toContain('%safeway%')
  })

  it('escapes each phrase, so a literal % stays literal', () => {
    expect(withPhrases(['100% beef']).params).toContain('%100\\% beef%')
  })

  it('adds no predicate when the list is empty', () => {
    expect(withPhrases([]).params.some((p) => String(p).startsWith('%'))).toBe(false)
  })
})
