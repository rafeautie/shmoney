import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it } from 'vitest'

// The backfill in 0038 pairs Transfers rows already on file, so it runs
// against a database migrated up to just before it

const DRIZZLE = join(__dirname, '../../../drizzle')
const TAG = '0038_transfer_pairs'
const DAY = 24 * 60 * 60

function run(db: DatabaseSync, tag: string): void {
  const sql = readFileSync(join(DRIZZLE, `${tag}.sql`), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint'))
    if (statement.trim()) db.exec(statement)
}

let db: DatabaseSync
const pairOf = (id: number): number | null =>
  (
    db.prepare('SELECT transfer_pair_id AS p FROM transactions WHERE id = ?').get(id) as {
      p: number | null
    }
  ).p

let ids: Record<string, number>

beforeAll(() => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  db = new DatabaseSync(':memory:')
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)
  for (const { tag } of entries.slice(
    0,
    entries.findIndex((e) => e.tag === TAG)
  ))
    run(db, tag)

  const account = (name: string, currency = 'USD'): number =>
    Number(
      db
        .prepare('INSERT INTO accounts (name, currency, balance, balance_date) VALUES (?, ?, 0, 0)')
        .run(name, currency).lastInsertRowid
    )
  const transfers = (
    db.prepare("SELECT id FROM categories WHERE system_key = 'transfers'").get() as { id: number }
  ).id
  let n = 0
  const txn = (
    accountId: number,
    amount: number,
    day: number,
    categoryId: number | null = transfers
  ): number =>
    Number(
      db
        .prepare(
          'INSERT INTO transactions (account_id, simplefin_id, posted, amount, description, category_id) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(accountId, `manual:${++n}`, 1_780_000_000 + day * DAY, amount, `T${n}`, categoryId)
        .lastInsertRowid
    )

  const checking = account('Checking')
  const savings = account('Savings')
  const brokerage = account('Brokerage')
  const euro = account('Euro', 'EUR')
  ids = {
    out: txn(checking, -500_000, 0),
    in: txn(savings, 500_000, 1),
    // two candidates for one leg: ambiguous, left unpaired
    amb: txn(checking, -70_000, 10),
    ambA: txn(savings, 70_000, 10),
    ambB: txn(brokerage, 70_000, 11),
    // too far apart
    farOut: txn(checking, -90_000, 20),
    farIn: txn(savings, 90_000, 24),
    // different currencies never pair
    usd: txn(checking, -30_000, 30),
    eur: txn(euro, 30_000, 30),
    // a partner outside Transfers isn't a filed pair
    filed: txn(checking, -40_000, 40),
    plain: txn(savings, 40_000, 40, null)
  }
  run(db, TAG)
})

describe('0038 transfer pair backfill', () => {
  it('links an unambiguous pair both ways', () => {
    expect(pairOf(ids.out)).toBe(ids.in)
    expect(pairOf(ids.in)).toBe(ids.out)
  })

  it('leaves ambiguous, distant, cross-currency and unfiled legs unpaired', () => {
    for (const key of ['amb', 'ambA', 'ambB', 'farOut', 'farIn', 'usd', 'eur', 'filed', 'plain'])
      expect(pairOf(ids[key]), key).toBeNull()
  })

  it('unlinks the partner when a leg is hard deleted', () => {
    db.exec('PRAGMA foreign_keys = ON')
    db.prepare('DELETE FROM transactions WHERE id = ?').run(ids.in)
    expect(pairOf(ids.out)).toBeNull()
  })
})
