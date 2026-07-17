import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import { scopeViewsDdl } from './sql-tool'

// The scope views are the seam that hands the model its data, and their whole
// job is to be exactly right about units. String-matching the DDL only proves
// the text; these run it. better-sqlite3 can't load here (Electron ABI), so
// this uses node's own SQLite against the real migrations — which also means a
// column renamed out from under a view fails here rather than in a chat reply.

const DRIZZLE = join(__dirname, '../../../drizzle')

interface Journal {
  entries: { idx: number; tag: string }[]
}

function migratedDb(): DatabaseSync {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as Journal
  const db = new DatabaseSync(':memory:')
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(join(DRIZZLE, `${entry.tag}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim()) db.exec(statement)
  }
  return db
}

/** milliunits in, so a view that forgets to divide reads back 1000x */
function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO accounts (id, name, currency, balance, available_balance, balance_date, invert_balance)
    VALUES (1, 'Checking', 'USD', 1234560, 1000000, 0, 0),
           (2, 'Card', 'USD', 250000, NULL, 0, 1);
    INSERT INTO transactions (id, account_id, simplefin_id, posted, amount, description, pending,
                              transacted_at)
    VALUES (1, 1, 't1', 100, -12340, 'Coffee', 0, 100),
           (2, 1, 't2', 200, 500000, 'Paycheck', 0, 200),
           (3, 2, 't3', 300, -1000, 'Gone', 0, 300);
    UPDATE transactions SET deleted_at = 999 WHERE id = 3;
    INSERT INTO holdings (id, account_id, simplefin_id, symbol, description, currency, shares,
                          market_value, cost_basis, purchase_price, created_at)
    VALUES (1, 1, 'h1', 'VTI', 'Total Market', 'USD', '1.23456789', 5000000, 4000000, 200000, 0);
    -- high ids and unlikely names: the migrations seed their own groups and
    -- categories, and both carry unique indexes
    INSERT INTO category_groups (id, name) VALUES (901, 'Test Group');
    INSERT INTO categories (id, group_id, name) VALUES (901, 901, 'Test Category');
    INSERT INTO budgets (id, category_id, month, amount) VALUES (1, 901, '2026-07', 30000);
  `)
}

function open(accountId: number | null): DatabaseSync {
  const db = migratedDb()
  seed(db)
  for (const ddl of scopeViewsDdl({ accountId })) db.exec(ddl)
  return db
}

/** what the model would get back, via the same unqualified names it writes */
function query(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all() as Record<string, unknown>[]
}

describe('scope views: amounts', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open(null)
  })

  it('hands transactions.amount over as a real amount, not milliunits', () => {
    expect(query(db, 'SELECT amount FROM transactions ORDER BY id')).toEqual([
      { amount: -12.34 },
      { amount: 500 }
    ])
  })

  // the failure this whole seam exists to prevent: the model writing the
  // obvious aggregate and stating a 1000x figure
  it('makes a bare SUM(amount) correct without the model scaling anything', () => {
    expect(query(db, 'SELECT ROUND(SUM(amount), 2) AS net FROM transactions')).toEqual([
      { net: 487.66 }
    ])
  })

  it('divides account balances and applies invert_balance', () => {
    expect(query(db, 'SELECT name, balance, available_balance FROM accounts ORDER BY id')).toEqual([
      { name: 'Checking', balance: 1234.56, available_balance: 1000 },
      // invert_balance = 1, and a NULL available_balance survives the flip
      { name: 'Card', balance: -250, available_balance: null }
    ])
  })

  it('does not expose invert_balance for the model to apply a second time', () => {
    const columns = query(db, 'PRAGMA table_info(accounts)').map((c) => c.name)
    expect(columns).not.toContain('invert_balance')
  })

  it('divides holdings money while leaving the shares string exact', () => {
    expect(
      query(db, 'SELECT shares, market_value, cost_basis, purchase_price FROM holdings')
    ).toEqual([{ shares: '1.23456789', market_value: 5000, cost_basis: 4000, purchase_price: 200 }])
  })

  it('divides budgets.amount, the one money table that used to read raw', () => {
    expect(query(db, 'SELECT amount FROM budgets')).toEqual([{ amount: 30 }])
  })

  it('still hides soft-deleted rows', () => {
    expect(query(db, 'SELECT COUNT(*) AS n FROM transactions')).toEqual([{ n: 2 }])
  })
})

describe('scope views: narrowing', () => {
  it('narrows transactions, accounts and holdings to the scoped account', () => {
    const db = open(2)
    expect(query(db, 'SELECT COUNT(*) AS n FROM transactions')).toEqual([{ n: 0 }])
    expect(query(db, 'SELECT name FROM accounts')).toEqual([{ name: 'Card' }])
    expect(query(db, 'SELECT COUNT(*) AS n FROM holdings')).toEqual([{ n: 0 }])
  })

  it('leaves budgets whole, since they are per-category rather than per-account', () => {
    expect(query(open(2), 'SELECT amount FROM budgets')).toEqual([{ amount: 30 }])
  })
})
