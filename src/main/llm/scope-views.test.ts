import type { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import { scopeViewsDdl } from './sql-tool'
import { migratedDb } from './test-db'

// The scope views are the seam that hands the model its data, and their whole
// job is to be exactly right about units. String-matching the DDL only proves
// the text; these run it, against the real migrations (see test-db.ts) — which
// also means a column renamed out from under a view fails here rather than in
// a chat reply.

/** milliunits in, so a view that forgets to divide reads back 1000x */
function seed(db: DatabaseSync): void {
  // 2026-06-11 12:00:00 UTC; midday keeps the local calendar date TZ-stable
  // for offsets up to ±11h
  const JUNE = 1781179200
  const JUNE_MS = 1781179200123 // same instant, but action_log's epochs are milliseconds
  const recent = Math.floor(Date.now() / 1000) - 5 * 86400
  db.exec(`
    INSERT INTO connections (id, access_url_encrypted, last_synced_at, created_at)
    VALUES (1, 'enc', ${JUNE}, '2026-06-11 12:00:00');
    INSERT INTO accounts (id, name, currency, balance, available_balance, balance_date, invert_balance)
    VALUES (1, 'Checking', 'USD', 1234560, 1000000, 0, 0),
           (2, 'Card', 'EUR', 250000, NULL, 0, 1);
    INSERT INTO transactions (id, account_id, simplefin_id, posted, amount, description, pending,
                              transacted_at, category_id)
    VALUES (1, 1, 't1', ${JUNE}, -12340, 'Coffee', 0, ${JUNE}, NULL),
           (2, 1, 't2', ${JUNE}, 500000, 'Paycheck', 0, ${JUNE}, NULL),
           (3, 2, 't3', ${JUNE}, -1000, 'Gone', 0, ${JUNE}, NULL),
           (4, 1, 't4', 0, -5000, 'Pending coffee', 1, ${JUNE}, NULL),
           (5, 1, 't5', 0, -2000, 'Unknown date', 0, 0, NULL),
           (6, 1, 't6', ${recent}, -1000, 'Recent', 0, ${recent}, NULL);
    UPDATE transactions SET deleted_at = 999 WHERE id = 3;
    -- id 6 becomes a transfer via the migration-seeded system category, looked
    -- up by system_key so the test never hardcodes a seeded id
    UPDATE transactions SET category_id = (SELECT id FROM categories WHERE system_key = 'transfers')
    WHERE id = 6;
    INSERT INTO holdings (id, account_id, simplefin_id, symbol, description, currency, shares,
                          market_value, cost_basis, purchase_price, created_at)
    VALUES (1, 1, 'h1', 'VTI', 'Total Market', 'USD', '1.23456789', 5000000, 4000000, 200000, 0);
    -- high ids and unlikely names: the migrations seed their own groups and
    -- categories, and both carry unique indexes
    INSERT INTO category_groups (id, name) VALUES (901, 'Test Group');
    INSERT INTO categories (id, group_id, name) VALUES (901, 901, 'Test Category');
    UPDATE transactions SET category_id = 901 WHERE id = 1;
    INSERT INTO budgets (id, category_id, month, amount) VALUES (1, 901, '2026-07', 30000);
    INSERT INTO rules (id, name, priority, conditions, action, created_at, updated_at)
    VALUES (901, 'Test Rule', 1, '{"version":1}', '{"version":1}', ${JUNE}, ${JUNE});
    -- created_at/undone_at are unix MILLISECONDS; a millis value mistakenly
    -- fed to unixepoch as seconds would land in year ~58400
    INSERT INTO action_log (id, created_at, source, label, changes, undone_at)
    VALUES (901, ${JUNE_MS}, 'user', 'Applied rule', '[]', NULL),
           (902, ${JUNE_MS}, 'user', 'Undone change', '[]', ${JUNE_MS});
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

  // rows 1, 2, 4, 5, 6 are visible (id 3 is soft-deleted); expectations are
  // extended to cover the seam's new date-focused rows rather than scoping
  // the query with WHERE id <= 2, so the query stays the naive one a model
  // would actually write
  it('hands transactions.amount over as a real amount, not milliunits', () => {
    expect(query(db, 'SELECT amount FROM transactions ORDER BY id')).toEqual([
      { amount: -12.34 },
      { amount: 500 },
      { amount: -5 },
      { amount: -2 },
      { amount: -1 }
    ])
  })

  // the failure this whole seam exists to prevent: the model writing the
  // obvious aggregate and stating a 1000x figure
  it('makes a bare SUM(amount) correct without the model scaling anything', () => {
    expect(query(db, 'SELECT ROUND(SUM(amount), 2) AS net FROM transactions')).toEqual([
      { net: 479.66 }
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
    expect(query(db, 'SELECT COUNT(*) AS n FROM transactions')).toEqual([{ n: 5 }])
  })

  it("carries the account's currency on transactions", () => {
    expect(query(db, 'SELECT currency FROM transactions WHERE account_id = 1 LIMIT 1')).toEqual([
      { currency: 'USD' }
    ])
  })
})

// every label the model reaches for must be a real column: it wrote
// `t.category` against a view without one, so the view grew one
describe('scope views: category names', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open(null)
  })

  it('carries category, category_group and system_key on transactions', () => {
    expect(
      query(db, 'SELECT category, category_group, system_key FROM transactions WHERE id = 1')
    ).toEqual([{ category: 'Test Category', category_group: 'Test Group', system_key: null }])
  })

  it('keeps uncategorized rows, with all three labels NULL', () => {
    expect(
      query(db, 'SELECT category, category_group, system_key FROM transactions WHERE id = 2')
    ).toEqual([{ category: null, category_group: null, system_key: null }])
  })

  it("marks a transfer with system_key = 'transfers', the app's own vocabulary", () => {
    expect(query(db, 'SELECT system_key FROM transactions WHERE id = 6')).toEqual([
      { system_key: 'transfers' }
    ])
    // and the base CTE's exclusion, spelled NULL-safe, keeps every other row
    expect(
      query(db, "SELECT COUNT(*) AS n FROM transactions WHERE system_key IS NOT 'transfers'")
    ).toEqual([{ n: 4 }])
  })

  it('carries the category name on budgets', () => {
    expect(query(db, 'SELECT category, amount FROM budgets')).toEqual([
      { category: 'Test Category', amount: 30 }
    ])
  })
})

describe('scope views: dates', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open(null)
  })

  it('exposes txn_date as local ISO text for dated rows', () => {
    const rows = query(db, 'SELECT txn_date FROM transactions WHERE id IN (1, 2, 4, 6) ORDER BY id')
    for (const row of rows) expect(row.txn_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("derives the pending row's (id 4) txn_date from transacted_at, matching a posted row's date", () => {
    const [postedRow, pendingRow] = query(
      db,
      'SELECT txn_date FROM transactions WHERE id IN (1, 4) ORDER BY id'
    )
    expect(pendingRow.txn_date).toEqual(expect.any(String))
    expect(pendingRow.txn_date).toBe(postedRow.txn_date)
  })

  it('leaves txn_date NULL when both posted and transacted_at are unknown (id 5), and IS NOT NULL excludes it', () => {
    expect(query(db, 'SELECT txn_date FROM transactions WHERE id = 5')).toEqual([
      { txn_date: null }
    ])
    expect(
      query(db, 'SELECT COUNT(*) AS n FROM transactions WHERE txn_date IS NOT NULL AND id = 5')
    ).toEqual([{ n: 0 }])
  })

  it('returns posted as local ISO datetime text, or NULL when it was 0', () => {
    expect(query(db, 'SELECT posted FROM transactions WHERE id = 1')).toEqual([
      { posted: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) }
    ])
    expect(query(db, 'SELECT posted FROM transactions WHERE id = 5')).toEqual([{ posted: null }])
  })

  // REGRESSION: txn_date used to be exposed as an epoch INTEGER, compared
  // against a date TEXT literal like date('now', ...). In SQLite every
  // integer sorts before every text value, so `epoch_int >= 'YYYY-MM-DD'` was
  // always false — a silent zero-row result, never an error — no matter how
  // recent the data actually was.
  it('a last-30-days comparison against txn_date actually matches the recent row', () => {
    const [{ n }] = query(
      db,
      "SELECT COUNT(*) AS n FROM transactions WHERE txn_date >= date('now', 'localtime', '-30 days')"
    ) as { n: number }[]
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('a cutoff string comparison excludes rows dated before it', () => {
    expect(
      query(db, "SELECT COUNT(*) AS n FROM transactions WHERE txn_date >= '9999-01-01'")
    ).toEqual([{ n: 0 }])
  })

  // connections.created_at is TEXT (current_timestamp default), not an epoch;
  // an 'unixepoch' conversion here silently turns every row NULL
  it('hands both connection timestamps over as datetime text, never NULL', () => {
    expect(query(db, 'SELECT last_synced_at, created_at FROM connections')).toEqual([
      {
        last_synced_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      }
    ])
  })
})

// the grain columns and the tx view exist so recipes never make the model
// write strftime or copy a base CTE; both fragile in its hands
describe('scope views: time grains and tx', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open(null)
  })

  it('exposes month, quarter, year and week as sortable local-time text', () => {
    expect(query(db, 'SELECT month, quarter, year, week FROM transactions WHERE id = 1')).toEqual([
      {
        month: '2026-06',
        quarter: '2026-Q2',
        year: '2026',
        week: expect.stringMatching(/^2026-W\d{2}$/)
      }
    ])
  })

  it('leaves every grain NULL alongside a NULL txn_date (id 5)', () => {
    expect(query(db, 'SELECT month, quarter, year, week FROM transactions WHERE id = 5')).toEqual([
      { month: null, quarter: null, year: null, week: null }
    ])
  })

  it('tx keeps only settled, dated, non-transfer rows', () => {
    expect(query(db, 'SELECT id FROM tx ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('tx inherits real amounts and the grain columns from the transactions view', () => {
    expect(query(db, 'SELECT month, amount FROM tx WHERE id = 1')).toEqual([
      { month: '2026-06', amount: -12.34 }
    ])
  })

  it('tx narrows with the scoped account like its base view', () => {
    expect(query(open(2), 'SELECT COUNT(*) AS n FROM tx')).toEqual([{ n: 0 }])
  })
})

describe('scope views: rules and action_log', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open(null)
  })

  it('returns rules created_at/updated_at as datetime text', () => {
    expect(query(db, 'SELECT created_at, updated_at FROM rules WHERE id = 901')).toEqual([
      {
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      }
    ])
  })

  // REGRESSION: created_at/undone_at are unix MILLISECONDS; a millis value
  // mistakenly fed to unixepoch as seconds would land in year ~58400
  it("renders action_log's millisecond epochs as the correct 2026-06 local date", () => {
    const rows = query(db, 'SELECT created_at, undone_at FROM action_log ORDER BY id') as {
      created_at: string
      undone_at: string | null
    }[]
    expect(rows[0].created_at.startsWith('2026-06')).toBe(true)
    expect(rows[0].undone_at).toBeNull()
    expect(rows[1].undone_at).toEqual(expect.any(String))
    expect(rows[1].undone_at!.startsWith('2026-06')).toBe(true)
  })

  it('does not expose the changes column', () => {
    const columns = query(db, 'PRAGMA table_info(action_log)').map((c) => c.name)
    expect(columns).not.toContain('changes')
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
