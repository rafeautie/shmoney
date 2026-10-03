import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Page, PageCursor, Transaction, TransactionSortBy } from '@shared/ipc'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code against the real migrations
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { transactionsPage } = await import('./transactions-page')

beforeAll(() => {
  runMigrations()
  const account = db
    .insert(schema.accounts)
    .values({ name: 'Visa', currency: 'USD', balance: 0, balanceDate: 0 })
    .returning({ id: schema.accounts.id })
    .get().id
  // ties on the date (shared local-noon dates), a pending row dated by
  // transacted_at, and a soft-deleted row
  const rows = [
    { posted: 300, transactedAt: null },
    { posted: 200, transactedAt: null },
    { posted: 200, transactedAt: null },
    { posted: 0, transactedAt: 250 },
    { posted: 200, transactedAt: null },
    { posted: 100, transactedAt: null },
    { posted: 0, transactedAt: null }
  ]
  rows.forEach((r, i) =>
    db
      .insert(schema.transactions)
      .values({ accountId: account, simplefinId: `t${i}`, amount: i, description: `d${i}`, ...r })
      .run()
  )
  db.insert(schema.transactions)
    .values({
      accountId: account,
      simplefinId: 'gone',
      posted: 260,
      amount: 0,
      description: 'deleted',
      deletedAt: 1
    })
    .run()
})

function all(
  sortBy: TransactionSortBy,
  sortDir: 'asc' | 'desc',
  pageSize: number
): Page<Transaction>[] {
  const pages: Page<Transaction>[] = []
  let cursor: PageCursor | null = 0
  while (cursor !== null) {
    const p = transactionsPage(undefined, { page: cursor, pageSize, sortBy, sortDir })
    pages.push(p)
    cursor = p.next
  }
  return pages
}

describe('transactionsPage', () => {
  it('derives the date from transacted_at when posted is 0', () => {
    const [p] = all('date', 'desc', 50)
    expect(p.rows.map((r) => r.date)).toEqual([300, 250, 200, 200, 200, 100, 0])
  })

  for (const sortDir of ['asc', 'desc'] as const) {
    it(`seeks through the ${sortDir} date sort without dups or gaps`, () => {
      const whole = all('date', sortDir, 50)[0].rows.map((r) => r.id)
      for (const size of [1, 2, 3]) {
        const pages = all('date', sortDir, size)
        expect(pages.flatMap((p) => p.rows.map((r) => r.id))).toEqual(whole)
        expect(pages.slice(1).every((p) => typeof p.total !== 'number')).toBe(true)
      }
    })
  }

  it('pages other sorts by index and counts only on the first page', () => {
    const pages = all('amount', 'asc', 3)
    expect(pages.map((p) => p.total)).toEqual([7, null, null])
    expect(pages.flatMap((p) => p.rows.map((r) => r.amount))).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(pages.map((p) => p.next)).toEqual([1, 2, null])
  })

  it('keeps the generated date in step with edits', () => {
    const id = all('date', 'desc', 50)[0].rows.at(-1)!.id
    db.update(schema.transactions).set({ posted: 999 }).where(eq(schema.transactions.id, id)).run()
    expect(all('date', 'desc', 50)[0].rows[0]).toMatchObject({ id, date: 999 })
  })
})
