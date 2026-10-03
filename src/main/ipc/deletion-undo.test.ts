import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { ACTION_LOG_IPC, IPC } from '@shared/ipc'
import { RULES_IPC } from '@shared/rules'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code against the real migrations
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { ipcRenderer } = await import('../../demo/shims/electron')
const { registerActionLogIpc } = await import('./action-log')
const { registerCategoriesIpc } = await import('./categories')
const { registerRulesIpc } = await import('./rules')

const invoke = <T>(channel: string, input?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, input) as Promise<T>

let account: number

function addTransaction(i: number, categoryId: number | null): number {
  return db
    .insert(schema.transactions)
    .values({
      accountId: account,
      simplefinId: `del${i}`,
      posted: 1_700_000_000 + i,
      amount: -100,
      description: `Row ${i}`,
      categoryId
    })
    .returning({ id: schema.transactions.id })
    .get().id
}

function addRule(name: string, categoryId: number): number {
  const now = 1_700_000_000
  return db
    .insert(schema.rules)
    .values({
      name,
      priority: 0,
      conditions: { description: { op: 'contains', phrases: ['row'] } },
      action: { type: 'setCategory', categoryId },
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: schema.rules.id })
    .get().id
}

const categoryOf = (id: number): number | null =>
  db
    .select({ c: schema.transactions.categoryId })
    .from(schema.transactions)
    .where(eq(schema.transactions.id, id))
    .get()!.c

beforeAll(() => {
  runMigrations()
  registerActionLogIpc()
  registerCategoriesIpc()
  registerRulesIpc()
  account = db
    .insert(schema.accounts)
    .values({ name: 'Checking', currency: 'USD', balance: 0, balanceDate: 0 })
    .returning({ id: schema.accounts.id })
    .get().id
})

describe('category group delete', () => {
  it('undo restores the group, its categories, assignments, fills and rules; redo deletes again', async () => {
    const group = db
      .insert(schema.categoryGroups)
      .values({ name: 'Fun' })
      .returning({ id: schema.categoryGroups.id })
      .get().id
    const [games, music] = ['Games', 'Music'].map(
      (name) =>
        db
          .insert(schema.categories)
          .values({ groupId: group, name })
          .returning({ id: schema.categories.id })
          .get().id
    )
    const t1 = addTransaction(1, games)
    const t2 = addTransaction(2, music)
    db.insert(schema.budgets).values({ categoryId: games, month: '2026-09', amount: 5000 }).run()
    const rule = addRule('Games rule', games)

    const actionId = await invoke<number>(IPC.categoriesDeleteGroup, group)
    expect(actionId).toBeTypeOf('number')
    expect(db.select().from(schema.categories).where(eq(schema.categories.id, games)).get()).toBe(
      undefined
    )
    expect(categoryOf(t1)).toBeNull()
    expect(db.select().from(schema.rules).where(eq(schema.rules.id, rule)).get()).toBe(undefined)

    await invoke(ACTION_LOG_IPC.undoEntry, actionId)
    expect(
      db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(inArray(schema.categories.id, [games, music]))
        .all()
    ).toHaveLength(2)
    expect(categoryOf(t1)).toBe(games)
    expect(categoryOf(t2)).toBe(music)
    expect(
      db.select().from(schema.budgets).where(eq(schema.budgets.categoryId, games)).get()?.amount
    ).toBe(5000)
    expect(db.select().from(schema.rules).where(eq(schema.rules.id, rule)).get()?.name).toBe(
      'Games rule'
    )

    await invoke(ACTION_LOG_IPC.redoEntry, actionId)
    expect(
      db.select().from(schema.categoryGroups).where(eq(schema.categoryGroups.id, group)).get()
    ).toBe(undefined)
    expect(categoryOf(t1)).toBeNull()
  })

  it('undo leaves a transaction the user recategorized since', async () => {
    const cat = db
      .insert(schema.categories)
      .values({ groupId: null, name: 'Pets' })
      .returning({ id: schema.categories.id })
      .get().id
    const other = db
      .insert(schema.categories)
      .values({ groupId: null, name: 'Vet' })
      .returning({ id: schema.categories.id })
      .get().id
    const t = addTransaction(3, cat)

    const actionId = await invoke<number>(IPC.categoriesDelete, cat)
    db.update(schema.transactions)
      .set({ categoryId: other })
      .where(eq(schema.transactions.id, t))
      .run()
    await invoke(ACTION_LOG_IPC.undoEntry, actionId)

    expect(
      db.select().from(schema.categories).where(eq(schema.categories.id, cat)).get()?.name
    ).toBe('Pets')
    expect(categoryOf(t)).toBe(other)
  })
})

describe('rule delete', () => {
  it('undo reinserts the rule with its id', async () => {
    const cat = db
      .insert(schema.categories)
      .values({ groupId: null, name: 'Coffee' })
      .returning({ id: schema.categories.id })
      .get().id
    const rule = addRule('Coffee rule', cat)

    const actionId = await invoke<number>(RULES_IPC.delete, rule)
    expect(db.select().from(schema.rules).where(eq(schema.rules.id, rule)).get()).toBe(undefined)

    await invoke(ACTION_LOG_IPC.undoEntry, actionId)
    expect(db.select().from(schema.rules).where(eq(schema.rules.id, rule)).get()?.name).toBe(
      'Coffee rule'
    )
  })
})
