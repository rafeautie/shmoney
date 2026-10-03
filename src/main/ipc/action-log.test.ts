import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ACTION_LOG_IPC,
  ACTION_LOG_PREVIEW_CHANGES,
  type ActionChange,
  type ActionLogChange,
  type ActionLogPage
} from '@shared/ipc'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code against the real migrations
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { ipcRenderer } = await import('../../demo/shims/electron')
const { registerActionLogIpc, recordAction } = await import('./action-log')

const page = (input: object = {}): Promise<ActionLogPage> =>
  ipcRenderer.invoke(ACTION_LOG_IPC.page, input) as Promise<ActionLogPage>

let txIds: number[]

function record(label: string, changes: ActionChange[]): number {
  // sql.js's transaction handle differs from better-sqlite3's only in its run() result type
  return db.transaction((tx) =>
    recordAction(tx as unknown as Parameters<typeof recordAction>[0], {
      source: 'user',
      label,
      changes
    })
  )
}

const recat = (transactionId: number, after: number | null): ActionChange => ({
  transactionId,
  field: 'categoryId',
  before: null,
  after
})

beforeAll(() => {
  runMigrations()
  registerActionLogIpc()
  const account = db
    .insert(schema.accounts)
    .values({ name: 'Visa', currency: 'USD', balance: 0, balanceDate: 0 })
    .returning({ id: schema.accounts.id })
    .get().id
  txIds = ['BLUE BOTTLE COFFEE', 'SQ *TACOS 50%', ...Array(20).fill('Filler')].map(
    (description, i) =>
      db
        .insert(schema.transactions)
        .values({
          accountId: account,
          simplefinId: `t${i}`,
          posted: 1_700_000_000 + i,
          amount: -100,
          description
        })
        .returning({ id: schema.transactions.id })
        .get().id
  )
})

describe('Activity search', () => {
  it('matches the label, carried names and current transaction descriptions', async () => {
    const coffee = record('Recategorized', [recat(txIds[0], null)])
    const tacos = record('Edited', [recat(txIds[1], null)])
    const preset = record('Deleted preset', [
      {
        field: 'savedFilterDeletedAt',
        savedFilterId: 1,
        name: 'Groceries',
        before: null,
        after: 1
      }
    ])
    const chat = record('Deleted chat', [
      {
        field: 'conversationDeletedAt',
        conversationId: 1,
        title: 'Trip planning',
        before: null,
        after: 1
      }
    ])
    const ids = async (q: string): Promise<number[]> => (await page({ q })).entries.map((e) => e.id)

    expect(await ids('bottle')).toEqual([coffee])
    expect(await ids('groceries')).toEqual([preset])
    expect(await ids('trip')).toEqual([chat])
    expect(await ids('deleted')).toEqual([chat, preset])
    // LIKE wildcards in the term are literal
    expect(await ids('50%')).toEqual([tacos])
    expect(await ids('5_%')).toEqual([])

    // the description searched is the current one, not the one at record time
    db.update(schema.transactions)
      .set({ description: 'RENAMED' })
      .where(eq(schema.transactions.id, txIds[0]))
      .run()
    expect(await ids('bottle')).toEqual([])
    expect(await ids('renamed')).toEqual([coffee])
  })
})

describe('Activity entries', () => {
  it('carry a preview of their changes and load the rest on demand', async () => {
    const id = record(
      'Bulk',
      txIds.map((t) => recat(t, 7))
    )
    const entry = (await page()).entries.find((e) => e.id === id)!
    expect(entry.changeCount).toBe(txIds.length)
    expect(entry.changes).toHaveLength(ACTION_LOG_PREVIEW_CHANGES)
    expect(entry.sharedCategoryId).toBe(7)
    expect(entry.domains).toEqual(['transactions'])

    const all = (await ipcRenderer.invoke(ACTION_LOG_IPC.entryChanges, id)) as ActionLogChange[]
    expect(all).toHaveLength(txIds.length)
    expect(all.slice(0, ACTION_LOG_PREVIEW_CHANGES)).toEqual(entry.changes)
    expect(all[0]).toMatchObject({ accountName: 'Visa', date: 1_700_000_000 })
  })

  it('have no shared category when their targets differ', async () => {
    const id = record('Mixed', [recat(txIds[0], 1), recat(txIds[1], 2)])
    const entry = (await page()).entries.find((e) => e.id === id)!
    expect(entry.sharedCategoryId).toBeNull()
  })

  it('drop their search links when deleted', () => {
    const id = record('Doomed', [recat(txIds[2], null)])
    const links = (): unknown[] =>
      db
        .select()
        .from(schema.actionLogTransactions)
        .where(eq(schema.actionLogTransactions.entryId, id))
        .all()
    expect(links()).toHaveLength(1)
    db.delete(schema.actionLog).where(eq(schema.actionLog.id, id)).run()
    expect(links()).toHaveLength(0)
  })
})
