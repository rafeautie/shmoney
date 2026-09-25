import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, isNull } from 'drizzle-orm'
import type { ChatMessagePart, Proposal, ProposalDisplay } from '@shared/chat'
import { ACTION_LOG_IPC } from '@shared/ipc'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code (and can't nest BEGIN, so it also proves the saves nest
// as savepoints inside the part rewrite)
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))
vi.mock('../access-url', () => import('../../demo/shims/access-url'))
vi.mock('../llm/manager', () => import('../../demo/llm-manager'))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { ipcRenderer } = await import('../../demo/shims/electron')
const { registerActionLogIpc } = await import('./action-log')
const { reconcileProposals, resolveProposal, undoProposal } = await import('./chat-proposals')
const { updateGoal } = await import('./goals')

const display = (proposal: Proposal): ProposalDisplay => ({
  proposal,
  status: 'approval-requested',
  actionId: null,
  applied: null,
  skipped: null
})

const call = (name: string, proposal: Proposal): ChatMessagePart => ({
  type: 'functionCall',
  durationMs: 1,
  name: name as 'recategorize',
  args: {},
  result: { ok: true, summary: 'Proposed.' },
  display: display(proposal)
})

let categoryId: (name: string) => number
let txIds: number[]
let goalId: number
let conversationId: number

function message(parts: ChatMessagePart[]): number {
  return db
    .insert(schema.chatMessages)
    .values({ conversationId, role: 'assistant', parts, createdAt: Date.now() })
    .returning({ id: schema.chatMessages.id })
    .get().id
}

const categoryOf = (id: number): number | null =>
  db
    .select({ c: schema.transactions.categoryId })
    .from(schema.transactions)
    .where(eq(schema.transactions.id, id))
    .get()!.c

const partDisplay = (parts: ChatMessagePart[], i: number): ProposalDisplay =>
  (parts[i] as { display: ProposalDisplay }).display

beforeAll(() => {
  runMigrations()
  registerActionLogIpc()
  const cats = db
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(isNull(schema.categories.systemKey))
    .all()
  categoryId = (name) => cats.find((c) => c.name === name)!.id
  const account = db
    .insert(schema.accounts)
    .values({ name: 'Visa', currency: 'USD', balance: 0, balanceDate: 0 })
    .returning({ id: schema.accounts.id })
    .get().id
  const now = Math.floor(Date.now() / 1000)
  const rows = [
    ['BLUE BOTTLE COFFEE', categoryId('🛍️ Shopping')],
    ['BLUE BOTTLE COFFEE', categoryId('🍽️ Dining Out')],
    ['SQ *TACOS EL GORDO', null]
  ] as const
  txIds = rows.map(
    ([description, category], i) =>
      db
        .insert(schema.transactions)
        .values({
          accountId: account,
          simplefinId: `t${i}`,
          posted: now,
          amount: -6500,
          description,
          pending: false,
          transactedAt: now,
          categoryId: category
        })
        .returning({ id: schema.transactions.id })
        .get().id
  )
  goalId = db
    .insert(schema.savingsGoals)
    .values({
      name: 'Trip',
      mode: 'contributions',
      targetAmount: 6_000_000,
      targetDate: '2030-03-31',
      startedAt: now - 86400,
      baselineAmount: 0,
      currency: 'USD',
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: schema.savingsGoals.id })
    .get().id
  conversationId = db
    .insert(schema.conversations)
    .values({ title: 'Chat', createdAt: 0, updatedAt: 0, modelLabel: 'test' })
    .returning({ id: schema.conversations.id })
    .get().id
})

describe('recategorize proposals', () => {
  const proposal = (): Extract<Proposal, { kind: 'recategorize' }> => ({
    kind: 'recategorize',
    toCategoryId: categoryId('🍽️ Dining Out'),
    toCategory: '🍽️ Dining Out',
    groups: [
      { merchant: 'Blue Bottle Coffee', transactionIds: [txIds[0], txIds[1]], total: -13 },
      { merchant: 'Tacos El Gordo', transactionIds: [txIds[2]], total: -6.5 }
    ],
    sample: [],
    currency: 'USD'
  })

  it('applies only the checked merchants, counts skips, and undoes', () => {
    const id = message([{ type: 'text', text: 'Sure.' }, call('recategorize', proposal())])
    const applied = resolveProposal({
      messageId: id,
      partIndex: 1,
      decision: 'approve',
      merchants: ['Blue Bottle Coffee']
    })
    const d = partDisplay(applied.parts, 1)
    // the second Blue Bottle row was already in Dining Out
    expect(d).toMatchObject({ status: 'approved', applied: 1, skipped: 1 })
    expect(categoryOf(txIds[0])).toBe(categoryId('🍽️ Dining Out'))
    expect(categoryOf(txIds[2])).toBeNull()
    const entry = db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.id, d.actionId!))
      .get()!
    expect(entry).toMatchObject({
      source: 'user',
      label: 'Recategorized 1 transaction to 🍽️ Dining Out from chat'
    })
    // persisted, so a reload sees it and a second apply is refused
    const stored = db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, id))
      .get()!
    expect(partDisplay(stored.parts, 1).status).toBe('approved')
    expect(() => resolveProposal({ messageId: id, partIndex: 1, decision: 'approve' })).toThrow(
      /approved, not approval-requested/
    )

    const undone = undoProposal({ messageId: id, partIndex: 1 })
    expect(partDisplay(undone.parts, 1).status).toBe('undone')
    expect(categoryOf(txIds[0])).toBe(categoryId('🛍️ Shopping'))
    // a second Undo (say, the toast after the card) is a no-op that returns the card
    expect(partDisplay(undoProposal({ messageId: id, partIndex: 1 }).parts, 1).status).toBe(
      'undone'
    )
    expect(categoryOf(txIds[0])).toBe(categoryId('🛍️ Shopping'))
  })

  it('skips rows deleted or recategorized since the preview', () => {
    const shopping = categoryId('🛍️ Shopping')
    const rows = [0, 1, 2].map((i) =>
      db
        .insert(schema.transactions)
        .values({
          accountId: db.select().from(schema.accounts).get()!.id,
          simplefinId: `stale${i}`,
          posted: 0,
          amount: -6500,
          description: 'AMAZON',
          pending: false,
          transactedAt: 0,
          categoryId: shopping
        })
        .returning({ id: schema.transactions.id })
        .get()
    )
    const ids = rows.map((r) => r.id)
    const id = message([
      call('recategorize', {
        ...proposal(),
        groups: [
          {
            merchant: 'Amazon',
            transactionIds: ids,
            fromCategoryIds: [shopping, shopping, shopping],
            total: -19.5
          }
        ]
      })
    ])
    db.update(schema.transactions)
      .set({ deletedAt: 123 })
      .where(eq(schema.transactions.id, ids[0]))
      .run()
    db.update(schema.transactions)
      .set({ categoryId: categoryId('🛒 Groceries') })
      .where(eq(schema.transactions.id, ids[1]))
      .run()
    const d = partDisplay(
      resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' }).parts,
      0
    )
    expect(d).toMatchObject({ status: 'approved', applied: 1, skipped: 2 })
    expect(categoryOf(ids[0])).toBe(shopping)
    expect(categoryOf(ids[1])).toBe(categoryId('🛒 Groceries'))
    expect(categoryOf(ids[2])).toBe(categoryId('🍽️ Dining Out'))
  })

  it('denies without writing', () => {
    const id = message([call('recategorize', proposal())])
    const denied = resolveProposal({ messageId: id, partIndex: 0, decision: 'deny' })
    expect(partDisplay(denied.parts, 0).status).toBe('denied')
    expect(categoryOf(txIds[2])).toBeNull()
  })

  it('refuses parts that are not proposals', () => {
    const id = message([{ type: 'text', text: 'hi' }])
    expect(() => resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' })).toThrow(
      /not a tool call/
    )
    expect(() => resolveProposal({ messageId: id, partIndex: 3, decision: 'approve' })).toThrow()
  })
})

describe('set_budget proposals', () => {
  it('writes the fill and undoes it', () => {
    const cat = categoryId('🛍️ Shopping')
    const id = message([
      call('set_budget', {
        kind: 'set_budget',
        categoryId: cat,
        category: '🛍️ Shopping',
        month: '2026-09',
        before: null,
        after: 300,
        averageSpending: null,
        currency: 'USD'
      })
    ])
    const d = partDisplay(
      resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' }).parts,
      0
    )
    expect(d).toMatchObject({ status: 'approved', applied: 1, skipped: 0 })
    const fill = (): { amount: number } | undefined =>
      db.select().from(schema.budgets).where(eq(schema.budgets.categoryId, cat)).get()
    expect(fill()?.amount).toBe(300_000)
    undoProposal({ messageId: id, partIndex: 0 })
    expect(fill()).toBeUndefined()
  })
})

describe('proposal state follows the action log', () => {
  const budget = (cat: number, after: number): Proposal => ({
    kind: 'set_budget',
    categoryId: cat,
    category: 'Dining',
    month: '2026-08',
    before: null,
    after,
    averageSpending: null,
    currency: 'USD'
  })
  const stored = (id: number): ChatMessagePart[] =>
    db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, id)).get()!.parts
  const reconciled = (id: number): ProposalDisplay =>
    partDisplay(reconcileProposals([{ parts: stored(id) }])[0].parts, 0)

  function applied(after: number): { id: number; actionId: number } {
    const id = message([call('set_budget', budget(categoryId('🍽️ Dining Out'), after))])
    const d = partDisplay(
      resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' }).parts,
      0
    )
    return { id, actionId: d.actionId! }
  }

  it('shows approved again after a redo of the undone entry', async () => {
    const { id, actionId } = applied(410)
    undoProposal({ messageId: id, partIndex: 0 })
    await ipcRenderer.invoke(ACTION_LOG_IPC.redoEntry, actionId)
    expect(reconciled(id)).toMatchObject({ status: 'approved', actionId })
    // and the card's Undo works again
    expect(partDisplay(undoProposal({ messageId: id, partIndex: 0 }).parts, 0).status).toBe(
      'undone'
    )
  })

  it('shows undone after the entry is undone elsewhere, and Undo just returns it', async () => {
    const { id, actionId } = applied(420)
    await ipcRenderer.invoke(ACTION_LOG_IPC.undoEntry, actionId)
    expect(reconciled(id).status).toBe('undone')
    const entry = (): number | null =>
      db.select().from(schema.actionLog).where(eq(schema.actionLog.id, actionId)).get()!.undoneAt
    const undoneAt = entry()
    expect(partDisplay(undoProposal({ messageId: id, partIndex: 0 }).parts, 0).status).toBe(
      'undone'
    )
    expect(entry()).toBe(undoneAt)
  })

  it('hides Undo once the entry is purged, and refuses it clearly', () => {
    const { id, actionId } = applied(430)
    db.delete(schema.actionLog).where(eq(schema.actionLog.id, actionId)).run()
    expect(reconciled(id)).toMatchObject({ status: 'approved', actionId: null })
    expect(() => undoProposal({ messageId: id, partIndex: 0 })).toThrow(
      /no longer in the Activity history/
    )
  })

  it('validates the fill before writing it', () => {
    const id = message([call('set_budget', budget(categoryId('🍽️ Dining Out'), -5))])
    expect(() => resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' })).toThrow()
    expect(partDisplay(stored(id), 0).status).toBe('approval-requested')
  })
})

describe('update_goal proposals', () => {
  const goal = (): typeof schema.savingsGoals.$inferSelect =>
    db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.id, goalId)).get()!

  it('applies a new target date through the goal update and undoes it', () => {
    const pace = { status: 'On track', neededPerMonth: 100, projectedDate: null }
    const id = message([
      call('update_goal', {
        kind: 'update_goal',
        goalId,
        goal: 'Trip',
        before: { targetAmount: 6000, targetDate: '2030-03-31', archived: false },
        after: { targetAmount: 6000, targetDate: '2031-06-30', archived: false },
        pace: { before: pace, after: pace },
        currency: 'USD'
      })
    ])
    const d = partDisplay(
      resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' }).parts,
      0
    )
    expect(goal().targetDate).toBe('2031-06-30')
    const entry = db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.id, d.actionId!))
      .get()!
    expect(entry.label).toBe('Changed Trip goal from chat')
    expect(entry.changes).toEqual([
      {
        field: 'savingsGoalTargetDate',
        goalId,
        name: 'Trip',
        before: '2030-03-31',
        after: '2031-06-30'
      }
    ])
    undoProposal({ messageId: id, partIndex: 0 })
    expect(goal().targetDate).toBe('2030-03-31')
  })

  it('validates the patch before writing it', () => {
    const pace = { status: 'On track', neededPerMonth: 100, projectedDate: null }
    const id = message([
      call('update_goal', {
        kind: 'update_goal',
        goalId,
        goal: 'Trip',
        before: { targetAmount: 6000, targetDate: '2030-03-31', archived: false },
        after: { targetAmount: 6000, targetDate: '2026-02-30', archived: true },
        pace: { before: pace, after: pace },
        currency: 'USD'
      })
    ])
    expect(() => resolveProposal({ messageId: id, partIndex: 0, decision: 'approve' })).toThrow()
    expect(goal()).toMatchObject({ targetDate: '2030-03-31', archivedAt: null })
  })

  it('logs every goal edit, and undo/redo skip a superseded field', async () => {
    const { actionId } = updateGoal({ id: goalId, targetAmount: 8_000_000, archived: true })
    const entry = db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.id, actionId!))
      .get()!
    expect(entry.label).toBe('Edit savings goal')
    expect(entry.changes.map((c) => c.field)).toEqual([
      'savingsGoalTargetAmount',
      'savingsGoalArchivedAt'
    ])
    const archivedAt = goal().archivedAt
    expect(archivedAt).not.toBeNull()
    // re-archiving keeps the timestamp and logs nothing
    expect(updateGoal({ id: goalId, archived: true }).actionId).toBeNull()

    // an edit since the entry supersedes the amount; only the archive reverts
    updateGoal({ id: goalId, targetAmount: 9_000_000 })
    // (sql.js reports no row counts, so the state is what's checked)
    await ipcRenderer.invoke(ACTION_LOG_IPC.undoEntry, actionId)
    expect(goal()).toMatchObject({ targetAmount: 9_000_000, archivedAt: null })
    await ipcRenderer.invoke(ACTION_LOG_IPC.redoEntry, actionId)
    expect(goal()).toMatchObject({ targetAmount: 9_000_000, archivedAt })
  })
})
