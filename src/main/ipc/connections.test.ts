import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code against the real migrations, and a `demo:` token is
// its own bridge
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))
vi.mock('../access-url', () => import('../../demo/shims/access-url'))
vi.mock('../llm/manager', () => import('../../demo/llm-manager'))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { ipcRenderer } = await import('../../demo/shims/electron')
const { IPC } = await import('@shared/ipc')
const { DEMO_TOKEN_PREFIX } = await import('@shared/demo')
const { registerConnectionsIpc } = await import('./connections')
const { allowDemoTokens } = await import('../simplefin')

const TOKEN = `${DEMO_TOKEN_PREFIX}household`

const accountRows = (): (typeof schema.accounts.$inferSelect)[] =>
  db.select().from(schema.accounts).orderBy(schema.accounts.id).all()
const transactionCount = (): number =>
  db
    .select({ n: sql<number>`count(*)` })
    .from(schema.transactions)
    .get()!.n

async function connectAndSync(): Promise<void> {
  await ipcRenderer.invoke(IPC.connectionConnect, { setupToken: TOKEN })
  await ipcRenderer.invoke(IPC.connectionSync)
}

beforeAll(async () => {
  runMigrations()
  registerConnectionsIpc()
  allowDemoTokens()
  await connectAndSync()
})

describe('account rename, delete and disconnect', () => {
  it('keeps a renamed synced account name across syncs', async () => {
    const [first] = accountRows()
    await ipcRenderer.invoke(IPC.accountsRename, { id: first.id, name: '  Joint checking ' })
    await ipcRenderer.invoke(IPC.connectionSync)
    const renamed = accountRows().find((a) => a.id === first.id)!
    expect(renamed.name).toBe('Joint checking')
  })

  it('disconnect detaches accounts and keeps their transactions', async () => {
    const before = accountRows()
    const txns = transactionCount()
    await ipcRenderer.invoke(IPC.connectionDisconnect)

    expect(db.select().from(schema.connections).all()).toHaveLength(0)
    const after = accountRows()
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id))
    expect(after.every((a) => a.connectionId === null)).toBe(true)
    expect(transactionCount()).toBe(txns)
  })

  it('reconnecting re-adopts the detached accounts instead of duplicating them', async () => {
    const before = accountRows()
    const txns = transactionCount()
    await connectAndSync()
    const after = accountRows()
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id))
    expect(after.every((a) => a.connectionId !== null)).toBe(true)
    expect(after[0].name).toBe('Joint checking')
    expect(transactionCount()).toBe(txns)
  })

  it('a deleted synced account stays gone on the next sync', async () => {
    const [victim] = accountRows()
    await ipcRenderer.invoke(IPC.accountsDelete, victim.id)
    await ipcRenderer.invoke(IPC.connectionSync)
    const after = accountRows()
    expect(after.some((a) => a.simplefinId === victim.simplefinId)).toBe(false)
    expect(
      db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.accountId, victim.id))
        .all()
    ).toHaveLength(0)
  })
})
