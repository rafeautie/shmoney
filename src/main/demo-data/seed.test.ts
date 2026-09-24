import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, isNull, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'

// The desktop app's better-sqlite3 won't load under vitest, but the web demo's
// in-memory sql.js database will. Running the seed against it exercises the
// same path as both products: connect a demo token, the real sync with
// transfer detection and rules, then the extras.
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))
vi.mock('../access-url', () => import('../../demo/shims/access-url'))
vi.mock('../llm/manager', () => import('../../demo/llm-manager'))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { clearData, seedDataset } = await import('./seed')
const { syncConnection } = await import('../ipc/connections')

const count = (table: SQLiteTable): number =>
  db
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .get()!.n

beforeAll(() => runMigrations())

describe('seedDataset household', () => {
  beforeAll(() => seedDataset('household'))

  it('lands every part of the dataset', () => {
    expect(count(schema.accounts)).toBe(4)
    expect(count(schema.holdings)).toBe(3)
    expect(count(schema.transactions)).toBeGreaterThan(500)
    expect(count(schema.rules)).toBeGreaterThan(0)
    expect(count(schema.budgets)).toBeGreaterThan(0)
    expect(count(schema.reports)).toBe(3)
    expect(count(schema.savingsGoals)).toBe(3)
    expect(count(schema.savingsGoalAccounts)).toBe(3)
    expect(count(schema.savedFilters)).toBe(2)
    expect(count(schema.ruleSuggestions)).toBe(1)
    expect(count(schema.conversations)).toBe(2)
  })

  it('pairs transfers and categorizes history through the real sync', () => {
    const transfers = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.transactions)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
      .where(eq(schema.categories.systemKey, 'transfers'))
      .get()!.n
    // monthly savings sweep, brokerage deposit and card autopay, both legs each
    expect(transfers).toBeGreaterThan(60)
    const uncategorized = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.transactions)
      .where(isNull(schema.transactions.categoryId))
      .get()!.n
    expect(uncategorized / count(schema.transactions)).toBeLessThan(0.1)
  })

  it('answers the seeded chats with charts drawn from the data', () => {
    const messages = db.select().from(schema.chatMessages).all()
    const charts = messages.flatMap((m) =>
      m.parts.filter((p) => p.type === 'functionCall' && p.name === 'chart')
    )
    expect(charts).toHaveLength(2)
    const unseen = db
      .select()
      .from(schema.conversations)
      .all()
      .filter((c) => c.seenReplyId === null)
    expect(unseen).toHaveLength(0)
  })

  it('re-syncs idempotently', async () => {
    const before = count(schema.transactions)
    await syncConnection()
    expect(count(schema.transactions)).toBe(before)
  })

  it('lands on the same ids every time', async () => {
    await seedDataset('household')
    const [first] = db.select().from(schema.reports).all()
    expect(first.id).toBe(1)
  })
})

describe('clearData', () => {
  it('leaves a fresh install with default categories', async () => {
    await seedDataset('starter')
    clearData()
    expect(count(schema.transactions)).toBe(0)
    expect(count(schema.accounts)).toBe(0)
    expect(count(schema.connections)).toBe(0)
    expect(count(schema.actionLog)).toBe(0)
    expect(count(schema.categories)).toBeGreaterThan(10)
  })

  it('takes the goals with it', async () => {
    await seedDataset('household')
    clearData()
    expect(count(schema.savingsGoals)).toBe(0)
    expect(count(schema.savingsGoalAccounts)).toBe(0)
  })
})
