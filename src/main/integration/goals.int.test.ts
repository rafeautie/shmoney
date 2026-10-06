import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GoalCreateInput, GoalSummary } from '@shared/goals'
import { api } from './harness/api'
import { account, noon, txn } from './harness/builders'
import { count, query } from './harness/db'
import { expectUndoRoundTrip } from './harness/undo'

const NOW = noon(2026, 9, 15)
const START = noon(2026, 6, 1)
const DAY = 86_400

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
})
afterAll(() => vi.useRealTimers())

const makeGoal = (
  accountIds: number[],
  over: Partial<GoalCreateInput> = {}
): Promise<GoalSummary> =>
  api.goals.create({
    name: 'Goal',
    mode: 'contributions',
    targetAmount: 1_000_000,
    startedAt: START,
    accountIds,
    ...over
  })

const find = async (id: number): Promise<GoalSummary | undefined> =>
  (await api.goals.list()).find((g) => g.id === id)

const goalRow = (
  id: number
): {
  name: string
  mode: string
  target_amount: number
  target_date: string | null
  started_at: number
  baseline_amount: number
  currency: string
  archived_at: number | null
  deleted_at: number | null
} =>
  query<ReturnType<typeof goalRow>>(
    `SELECT name, mode, target_amount, target_date, started_at, baseline_amount, currency, archived_at, deleted_at FROM savings_goals WHERE id = ${id}`
  )[0]

const linkedIds = (id: number): number[] =>
  query<{ account_id: number }>(
    `SELECT account_id FROM savings_goal_accounts WHERE goal_id = ${id} ORDER BY account_id`
  ).map((r) => r.account_id)

const newestEntry = (): number =>
  query<{ id: number | null }>('SELECT max(id) AS id FROM action_log')[0].id ?? 0

const entryChanges = (id: number): { field: string; before: unknown; after: unknown }[] => {
  const [row] = query<{ changes: string }>(`SELECT changes FROM action_log WHERE id = ${id}`)
  return JSON.parse(row.changes)
}

describe('create', () => {
  it.each([
    ['a blank name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['a zero target', { targetAmount: 0 }],
    ['a negative target', { targetAmount: -5000 }],
    ['a fractional target', { targetAmount: 1000.5 }],
    ['an impossible calendar date', { targetDate: '2027-02-30' }],
    ['a malformed date', { targetDate: '2027-2-3' }],
    ['no accounts', { accountIds: [] }]
  ] satisfies [string, Partial<GoalCreateInput>][])('rejects %s', async (_label, over) => {
    const a = account()
    const before = count('savings_goals')
    await expect(makeGoal([a], over)).rejects.toThrow()
    expect(count('savings_goals')).toBe(before)
  })

  it('accepts the longest name and a leap day', async () => {
    const a = account()
    const goal = await makeGoal([a], { name: 'x'.repeat(100), targetDate: '2028-02-29' })
    expect(goal.name).toHaveLength(100)
    expect(goal.targetDate).toBe('2028-02-29')
  })

  it('trims the name', async () => {
    const goal = await makeGoal([account()], { name: '  Holiday  ' })
    expect(goal.name).toBe('Holiday')
  })

  it('rejects a start in the future, and accepts one that is exactly now', async () => {
    const a = account()
    await expect(makeGoal([a], { startedAt: NOW + DAY })).rejects.toThrow(
      "A goal can't start in the future"
    )
    const goal = await makeGoal([a], { startedAt: NOW })
    expect(goal.startedAt).toBe(NOW)
  })

  it('defaults the start to now', async () => {
    const goal = await makeGoal([account()], { startedAt: undefined })
    expect(goal.startedAt).toBe(Math.floor(Date.now() / 1000))
  })

  it('rejects a target date that is not after the start', async () => {
    const a = account()
    await expect(makeGoal([a], { targetDate: '2026-05-31' })).rejects.toThrow(
      'The target date has to be after the start'
    )
  })

  it('treats the whole target day as available, so the start day itself is legal', async () => {
    const goal = await makeGoal([account()], { targetDate: '2026-06-01' })
    expect(goal.targetDate).toBe('2026-06-01')
  })

  it('rejects an account that does not exist', async () => {
    const a = account()
    const before = count('savings_goals')
    await expect(makeGoal([a, 999_999])).rejects.toThrow('One of those accounts no longer exists')
    expect(count('savings_goals')).toBe(before)
  })

  it('rejects accounts in different currencies', async () => {
    const usd = account({ currency: 'USD' })
    const eur = account({ currency: 'EUR' })
    await expect(makeGoal([usd, eur])).rejects.toThrow(
      'A goal can only track accounts that share one currency'
    )
  })

  it.todo(
    'TRIAGE: duplicate accountIds ([a, a]) fail with "One of those accounts no longer exists" because rows.length != accountIds.length (src/main/ipc/goals.ts:45)'
  )

  it("copies the accounts' currency onto the goal and links every account", async () => {
    const a = account({ currency: 'EUR' })
    const b = account({ currency: 'EUR' })
    const goal = await makeGoal([a, b])
    expect(goal.currency).toBe('EUR')
    expect(goalRow(goal.id).currency).toBe('EUR')
    expect(linkedIds(goal.id)).toEqual([a, b].sort((x, y) => x - y))
    expect(goal.accounts.map((x) => x.id).sort((x, y) => x - y)).toEqual([a, b])
  })

  it('stores a null target date when none is given, and the date when it is', async () => {
    const a = account()
    expect((await makeGoal([a])).targetDate).toBeNull()
    expect((await makeGoal([a], { targetDate: null })).targetDate).toBeNull()
    expect((await makeGoal([a], { targetDate: '2027-03-01' })).targetDate).toBe('2027-03-01')
  })

  it('writes no action-log entry', async () => {
    const before = count('action_log')
    await makeGoal([account()])
    expect(count('action_log')).toBe(before)
  })

  it('baselines a balance goal at what was saved before it started', async () => {
    const a = account({ balance: 500_000 })
    txn(a, { posted: noon(2026, 5, 1), amount: 200_000 })
    txn(a, { posted: noon(2026, 7, 10), amount: 50_000 })
    const goal = await makeGoal([a], { mode: 'balance' })
    // 750k now, 50k of it earned after the start
    expect(goal.progress).toBe(750_000)
    expect(goal.baselineAmount).toBe(700_000)
    expect(goalRow(goal.id).baseline_amount).toBe(700_000)
  })

  it('starts a contributions goal from zero whatever the history', async () => {
    const a = account({ balance: 500_000 })
    txn(a, { posted: noon(2026, 5, 1), amount: 200_000 })
    txn(a, { posted: noon(2026, 7, 10), amount: 50_000 })
    const goal = await makeGoal([a], { mode: 'contributions' })
    expect(goal.baselineAmount).toBe(0)
    expect(goal.progress).toBe(50_000)
  })
})

describe('update', () => {
  it('rejects an unknown goal', async () => {
    await expect(api.goals.update({ id: 999_999, name: 'x' })).rejects.toThrow(
      'Goal 999999 not found'
    )
  })

  it('rejects a deleted goal', async () => {
    const goal = await makeGoal([account()])
    await api.goals.remove({ id: goal.id })
    await expect(api.goals.update({ id: goal.id, name: 'x' })).rejects.toThrow(
      `Goal ${goal.id} not found`
    )
  })

  it('renames without logging anything', async () => {
    const goal = await makeGoal([account()])
    const before = count('action_log')
    const updated = await api.goals.update({ id: goal.id, name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(count('action_log')).toBe(before)
  })

  it('ignores a mode key, since the mode is fixed at creation', async () => {
    const goal = await makeGoal([account()], { mode: 'balance' })
    const updated = await api.goals.update({ id: goal.id, mode: 'contributions' } as never)
    expect(updated.mode).toBe('balance')
    expect(goalRow(goal.id).mode).toBe('balance')
  })

  it('replaces the linked accounts, re-derives the currency and recomputes the baseline', async () => {
    const usd = account({ currency: 'USD', balance: 100_000 })
    const eur = account({ currency: 'EUR', balance: 500_000 })
    txn(eur, { posted: noon(2026, 7, 10), amount: 30_000 })
    const goal = await makeGoal([usd], { mode: 'balance' })
    expect(goal.baselineAmount).toBe(100_000)

    const updated = await api.goals.update({ id: goal.id, accountIds: [eur] })

    expect(linkedIds(goal.id)).toEqual([eur])
    expect(updated.currency).toBe('EUR')
    expect(updated.progress).toBe(530_000)
    expect(updated.baselineAmount).toBe(500_000)
  })

  it('leaves the goal untouched when the new accounts are bad', async () => {
    const usd = account({ currency: 'USD' })
    const eur = account({ currency: 'EUR' })
    const goal = await makeGoal([usd])
    const before = goalRow(goal.id)

    await expect(api.goals.update({ id: goal.id, accountIds: [usd, eur] })).rejects.toThrow(
      'share one currency'
    )
    await expect(api.goals.update({ id: goal.id, accountIds: [999_999] })).rejects.toThrow(
      'no longer exists'
    )

    expect(goalRow(goal.id)).toEqual(before)
    expect(linkedIds(goal.id)).toEqual([usd])
  })

  it('rejects an empty account list', async () => {
    const goal = await makeGoal([account()])
    await expect(api.goals.update({ id: goal.id, accountIds: [] })).rejects.toThrow()
  })

  it('recomputes a balance baseline when the start moves', async () => {
    const a = account({ balance: 100_000 })
    txn(a, { posted: noon(2026, 7, 10), amount: 40_000 })
    const goal = await makeGoal([a], { mode: 'balance' })
    expect(goal.baselineAmount).toBe(100_000)

    const updated = await api.goals.update({ id: goal.id, startedAt: noon(2026, 8, 1) })

    expect(updated.startedAt).toBe(noon(2026, 8, 1))
    expect(updated.baselineAmount).toBe(140_000)
  })

  it('validates a new start against now and the existing target date', async () => {
    const goal = await makeGoal([account()], { targetDate: '2026-12-01' })
    await expect(api.goals.update({ id: goal.id, startedAt: NOW + DAY })).rejects.toThrow(
      "A goal can't start in the future"
    )
    await expect(api.goals.update({ id: goal.id, startedAt: noon(2026, 12, 2) })).rejects.toThrow()
    await expect(api.goals.update({ id: goal.id, targetDate: '2026-05-01' })).rejects.toThrow(
      'The target date has to be after the start'
    )
    expect(goalRow(goal.id).started_at).toBe(START)
  })

  it('keeps the target date when it is omitted and clears it when it is null', async () => {
    const goal = await makeGoal([account()], { targetDate: '2027-01-01' })

    const kept = await api.goals.update({ id: goal.id, targetAmount: 2_000_000 })
    expect(kept.targetDate).toBe('2027-01-01')

    const cleared = await api.goals.update({ id: goal.id, targetDate: null })
    expect(cleared.targetDate).toBeNull()
    expect(goalRow(goal.id).target_date).toBeNull()

    const set = await api.goals.update({ id: goal.id, targetDate: '2027-06-30' })
    expect(set.targetDate).toBe('2027-06-30')
  })

  it('rejects a bad target amount or date', async () => {
    const goal = await makeGoal([account()])
    await expect(api.goals.update({ id: goal.id, targetAmount: 0 })).rejects.toThrow()
    await expect(api.goals.update({ id: goal.id, targetDate: '2027-02-30' })).rejects.toThrow()
    await expect(api.goals.update({ id: goal.id, name: '' })).rejects.toThrow()
  })

  describe('archive', () => {
    it('archives and unarchives, and archived goals sort last', async () => {
      const a = account()
      const first = await makeGoal([a], { name: 'first' })
      const second = await makeGoal([a], { name: 'second' })

      const archived = await api.goals.update({ id: first.id, archived: true })
      expect(archived.archivedAt).toBe(NOW)
      const ids = (await api.goals.list()).map((g) => g.id)
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))

      const restored = await api.goals.update({ id: first.id, archived: false })
      expect(restored.archivedAt).toBeNull()
    })

    it('keeps the original timestamp, and logs nothing, when archived twice', async () => {
      const goal = await makeGoal([account()])
      await api.goals.update({ id: goal.id, archived: true })
      const stamp = goalRow(goal.id).archived_at
      const before = count('action_log')

      vi.setSystemTime((NOW + 3 * DAY) * 1000)
      try {
        await api.goals.update({ id: goal.id, archived: true })
      } finally {
        vi.setSystemTime(NOW * 1000)
      }

      expect(goalRow(goal.id).archived_at).toBe(stamp)
      expect(count('action_log')).toBe(before)
    })

    it('unarchiving a goal that is not archived logs nothing', async () => {
      const goal = await makeGoal([account()])
      const before = count('action_log')
      await api.goals.update({ id: goal.id, archived: false })
      expect(count('action_log')).toBe(before)
    })
  })

  describe('action log', () => {
    it('records a target amount change and undoes it', async () => {
      const goal = await makeGoal([account({ currency: 'EUR' })])
      const entry = await expectUndoRoundTrip(() =>
        api.goals.update({ id: goal.id, targetAmount: 2_500_000 })
      )
      expect(entryChanges(entry)).toEqual([
        expect.objectContaining({
          field: 'savingsGoalTargetAmount',
          goalId: goal.id,
          before: 1_000_000,
          after: 2_500_000,
          currency: 'EUR'
        })
      ])
      expect(query(`SELECT source, label FROM action_log WHERE id = ${entry}`)).toEqual([
        { source: 'user', label: 'Edit savings goal' }
      ])
    })

    it('records a target date change and undoes it', async () => {
      const goal = await makeGoal([account()], { targetDate: '2027-01-01' })
      const entry = await expectUndoRoundTrip(() =>
        api.goals.update({ id: goal.id, targetDate: '2027-09-09' })
      )
      expect(entryChanges(entry)).toEqual([
        expect.objectContaining({
          field: 'savingsGoalTargetDate',
          before: '2027-01-01',
          after: '2027-09-09'
        })
      ])
    })

    it('records clearing a target date and undoes it', async () => {
      const goal = await makeGoal([account()], { targetDate: '2027-01-01' })
      const entry = await expectUndoRoundTrip(() =>
        api.goals.update({ id: goal.id, targetDate: null })
      )
      expect(entryChanges(entry)).toEqual([
        expect.objectContaining({
          field: 'savingsGoalTargetDate',
          before: '2027-01-01',
          after: null
        })
      ])
    })

    it('records archiving and undoes it', async () => {
      const goal = await makeGoal([account()])
      const entry = await expectUndoRoundTrip(() =>
        api.goals.update({ id: goal.id, archived: true })
      )
      expect(entryChanges(entry)).toEqual([
        expect.objectContaining({ field: 'savingsGoalArchivedAt', before: null, after: NOW })
      ])
      expect(goalRow(goal.id).archived_at).toBe(NOW)
    })

    it('records unarchiving and undoes it', async () => {
      const goal = await makeGoal([account()])
      await api.goals.update({ id: goal.id, archived: true })
      const entry = await expectUndoRoundTrip(() =>
        api.goals.update({ id: goal.id, archived: false })
      )
      expect(entryChanges(entry)).toEqual([
        expect.objectContaining({ field: 'savingsGoalArchivedAt', before: NOW, after: null })
      ])
    })

    it('writes one entry per update, holding only the logged fields', async () => {
      const a = account()
      const goal = await makeGoal([a], { targetDate: '2027-01-01' })
      const before = count('action_log')

      await api.goals.update({
        id: goal.id,
        name: 'Renamed',
        targetAmount: 3_000_000,
        targetDate: null,
        archived: true,
        accountIds: [a],
        startedAt: noon(2026, 7, 1)
      })

      expect(count('action_log')).toBe(before + 1)
      const changes = entryChanges(newestEntry())
      expect(changes.map((c) => c.field).sort()).toEqual([
        'savingsGoalArchivedAt',
        'savingsGoalTargetAmount',
        'savingsGoalTargetDate'
      ])
      // the new name is what the entry carries for display
      expect(changes.every((c) => (c as { name?: string }).name === 'Renamed')).toBe(true)
    })

    it('writes nothing for a target amount or date that did not change', async () => {
      const goal = await makeGoal([account()], { targetDate: '2027-01-01' })
      const before = count('action_log')
      await api.goals.update({ id: goal.id, targetAmount: 1_000_000, targetDate: '2027-01-01' })
      expect(count('action_log')).toBe(before)
    })

    it('does not log account or start changes', async () => {
      const a = account()
      const b = account()
      const goal = await makeGoal([a])
      const before = count('action_log')
      await api.goals.update({ id: goal.id, accountIds: [b], startedAt: noon(2026, 7, 1) })
      expect(count('action_log')).toBe(before)
    })
  })
})

describe('remove', () => {
  it('soft deletes the goal, hides it from the list, and undoes', async () => {
    const goal = await makeGoal([account()])
    let actionId = 0
    const entry = await expectUndoRoundTrip(async () => {
      actionId = (await api.goals.remove({ id: goal.id })).actionId as number
    })
    expect(actionId).toBe(entry)

    expect(query(`SELECT source, label FROM action_log WHERE id = ${entry}`)).toEqual([
      { source: 'user', label: 'Delete savings goal' }
    ])
    expect(entryChanges(entry)).toEqual([
      expect.objectContaining({ field: 'savingsGoalDeletedAt', goalId: goal.id, before: null })
    ])
    // the round trip ends on the redo: deleted again, row kept for another undo
    expect(goalRow(goal.id).deleted_at).toBe(NOW)
    expect(await find(goal.id)).toBeUndefined()

    await api.actionLog.undoEntry(entry)
    expect(goalRow(goal.id).deleted_at).toBeNull()
    expect((await find(goal.id))?.name).toBe('Goal')
  })

  it('returns a null actionId for a goal that is already deleted', async () => {
    const goal = await makeGoal([account()])
    await api.goals.remove({ id: goal.id })
    const before = count('action_log')
    expect(await api.goals.remove({ id: goal.id })).toEqual({ actionId: null })
    expect(count('action_log')).toBe(before)
  })

  it('returns a null actionId for an unknown goal', async () => {
    expect(await api.goals.remove({ id: 999_999 })).toEqual({ actionId: null })
  })

  it('rejects a bad id', async () => {
    await expect(api.goals.remove({ id: 0 })).rejects.toThrow()
  })
})

describe('saved amount', () => {
  it('balance mode sums the derived balances of every linked account', async () => {
    const a = account({ balance: 300_000 })
    const b = account({ balance: 50_000 })
    const other = account({ balance: 9_000_000 })
    txn(a, { amount: 20_000 })
    txn(a, { amount: -5_000, posted: noon(2026, 5, 1) })
    txn(b, { amount: 70_000 })
    txn(other, { amount: 1_000 })
    txn(a, { amount: 99_000, pending: true })
    txn(a, { amount: 88_000, deletedAt: 1 })

    const goal = await makeGoal([a, b], { mode: 'balance' })

    // 300k + 20k - 5k, plus 50k + 70k; pending and deleted rows don't count
    expect(goal.progress).toBe(435_000)
    expect((await find(goal.id))?.progress).toBe(435_000)
  })

  it('balance mode honors the account anchor date', async () => {
    const a = account({ balance: 100_000, balanceDate: noon(2026, 8, 1) })
    txn(a, { amount: 7_000, posted: noon(2026, 7, 1) })
    txn(a, { amount: 3_000, posted: noon(2026, 8, 20) })
    const goal = await makeGoal([a], { mode: 'balance' })
    expect(goal.progress).toBe(103_000)
  })

  it('contributions mode sums settled rows strictly after the start, from every linked account', async () => {
    const a = account({ balance: 999_000 })
    const b = account()
    txn(a, { amount: 10_000, posted: noon(2026, 5, 1) })
    txn(a, { amount: 40_000, posted: START })
    txn(a, { amount: 25_000, posted: START + 1 })
    txn(a, { amount: 15_000, posted: noon(2026, 8, 1) })
    txn(b, { amount: -5_000, posted: noon(2026, 8, 2) })
    txn(a, { amount: 60_000, posted: noon(2026, 8, 3), pending: true })
    txn(a, { amount: 70_000, posted: noon(2026, 8, 4), deletedAt: 1 })

    const goal = await makeGoal([a, b])

    expect(goal.progress).toBe(35_000)
    expect(goal.baselineAmount).toBe(0)
  })

  it('counts a transaction with no posted date by its transacted date', async () => {
    const a = account()
    txn(a, { amount: 12_000, posted: 0, transactedAt: noon(2026, 8, 1) })
    txn(a, { amount: 99_000, posted: 0, transactedAt: noon(2026, 5, 1) })
    const goal = await makeGoal([a])
    expect(goal.progress).toBe(12_000)
  })

  it('one account can back several goals, each with its own start', async () => {
    const a = account()
    txn(a, { amount: 10_000, posted: noon(2026, 7, 1) })
    txn(a, { amount: 20_000, posted: noon(2026, 8, 1) })
    const early = await makeGoal([a])
    const late = await makeGoal([a], { startedAt: noon(2026, 7, 15) })
    expect(early.progress).toBe(30_000)
    expect(late.progress).toBe(20_000)
  })

  it('reads the live numbers on later list calls', async () => {
    const a = account()
    const goal = await makeGoal([a])
    expect(goal.progress).toBe(0)
    txn(a, { amount: 5_000, posted: noon(2026, 8, 1) })
    expect((await find(goal.id))?.progress).toBe(5_000)
  })

  it('deleting a linked account drops the link and keeps the goal', async () => {
    const a = account({ name: 'Keep', balance: 10_000 })
    const b = account({ name: 'Drop', balance: 40_000, currency: 'USD' })
    const goal = await makeGoal([a, b], { mode: 'balance' })
    expect(goal.progress).toBe(50_000)

    expect(await api.accounts.delete(b)).toBe(true)

    const after = await find(goal.id)
    expect(after?.accounts.map((x) => x.id)).toEqual([a])
    expect(after?.progress).toBe(10_000)
    expect(linkedIds(goal.id)).toEqual([a])
  })

  it('a goal whose last account is deleted has no accounts, saves 0 and keeps its currency', async () => {
    const a = account({ balance: 80_000, currency: 'EUR' })
    txn(a, { amount: 5_000, posted: noon(2026, 8, 1) })
    const balanceGoal = await makeGoal([a], { mode: 'balance' })
    const contribGoal = await makeGoal([a], { mode: 'contributions' })
    expect(balanceGoal.progress).toBe(85_000)
    expect(contribGoal.progress).toBe(5_000)

    await api.accounts.delete(a)

    for (const id of [balanceGoal.id, contribGoal.id]) {
      const goal = await find(id)
      expect(goal?.accounts).toEqual([])
      expect(goal?.progress).toBe(0)
      expect(goal?.currency).toBe('EUR')
    }
  })
})

describe('status', () => {
  const START_JAN = noon(2026, 1, 1)

  /** a contributions goal that has saved `saved` since January */
  async function savedGoal(
    saved: number,
    over: Partial<GoalCreateInput> = {}
  ): Promise<GoalSummary> {
    const a = account()
    if (saved !== 0) txn(a, { amount: saved, posted: noon(2026, 3, 1) })
    const goal = await makeGoal([a], { startedAt: START_JAN, targetAmount: 1_000_000, ...over })
    return (await find(goal.id))!
  }

  it('reached: progress at or past the target, with or without a date', async () => {
    const dated = await savedGoal(1_000_000, { targetDate: '2027-01-01' })
    expect(dated.status).toBe('reached')
    expect(dated.remaining).toBe(0)
    expect(dated.neededPerMonth).toBeNull()
    expect(dated.projectedDate).toBeNull()

    const undated = await savedGoal(1_200_000)
    expect(undated.status).toBe('reached')
    expect(undated.remaining).toBe(0)
  })

  it('reached beats overdue', async () => {
    const goal = await savedGoal(1_000_000, { targetDate: '2026-09-01' })
    expect(goal.status).toBe('reached')
  })

  it('no-date: an undated goal short of its target', async () => {
    const empty = await savedGoal(0)
    expect(empty.status).toBe('no-date')
    expect(empty.expectedByNow).toBeNull()
    expect(empty.neededPerMonth).toBeNull()
    expect(empty.projectedDate).toBeNull()
    expect(empty.remaining).toBe(1_000_000)

    // a positive average still projects a finish
    const saving = await savedGoal(400_000)
    expect(saving.status).toBe('no-date')
    expect(saving.neededPerMonth).toBeNull()
    expect(saving.projectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('overdue: the target day has ended and the goal is short', async () => {
    const goal = await savedGoal(100_000, { targetDate: '2026-09-01' })
    expect(goal.status).toBe('overdue')
    expect(goal.neededPerMonth).toBeNull()
    expect(goal.expectedByNow).toBe(1_000_000)
    expect(goal.projectedDate).not.toBeNull()
  })

  it('is not overdue on the target day itself', async () => {
    const goal = await savedGoal(0, { targetDate: '2026-09-15' })
    expect(goal.status).not.toBe('overdue')
  })

  it('behind: short of the pace line, with a monthly need and a projection', async () => {
    const goal = await savedGoal(100_000, { targetDate: '2027-01-01' })
    expect(goal.status).toBe('behind')
    expect(goal.expectedByNow).toBeGreaterThan(goal.progress)
    // 900k left over the 4 calendar months to January
    expect(goal.neededPerMonth).toBe(225_000)
    // 100k over 8 calendar months is 12.5k a month, so 72 more months
    expect(goal.averagePerMonth).toBe(12_500)
    expect(goal.projectedDate).toBe('2032-09-15')
  })

  it('on-track: at or past the pace line', async () => {
    const goal = await savedGoal(900_000, { targetDate: '2027-01-01' })
    expect(goal.status).toBe('on-track')
    expect(goal.progress).toBeGreaterThanOrEqual(goal.expectedByNow!)
    expect(goal.neededPerMonth).toBe(25_000)
    expect(goal.projectedDate).toBe('2026-10-15')
  })

  it('a balance goal measures the pace line from its baseline, not from zero', async () => {
    const a = account({ balance: 800_000 })
    // 800k already there at the start, 50k added since: well short of the line to 1M
    txn(a, { amount: 50_000, posted: noon(2026, 7, 1) })
    const goal = await makeGoal([a], {
      mode: 'balance',
      startedAt: START_JAN,
      targetDate: '2027-01-01'
    })
    const summary = (await find(goal.id))!
    expect(summary.baselineAmount).toBe(800_000)
    expect(summary.progress).toBe(850_000)
    expect(summary.expectedByNow).toBeGreaterThan(900_000)
    expect(summary.status).toBe('behind')
  })
})

describe('series', () => {
  const pointsOf = (
    rows: { groupId: number | null; bucket: string | null; value: number }[],
    id: number
  ): (string | number | null)[][] =>
    rows.filter((r) => r.groupId === id).map((r) => [r.bucket, r.value])

  it('returns nothing for an archived goal, even when it is named', async () => {
    const goal = await makeGoal([account()])
    await api.goals.update({ id: goal.id, archived: true })
    expect(
      await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'month',
        dateStart: null,
        dateEnd: null
      })
    ).toEqual({ rows: [], currencies: [] })
  })

  it('returns nothing for a deleted or unknown goal', async () => {
    const goal = await makeGoal([account()])
    await api.goals.remove({ id: goal.id })
    const result = await api.goals.series({
      goalIds: [goal.id, 999_999],
      timeGrain: 'month',
      dateStart: null,
      dateEnd: null
    })
    expect(result.rows).toEqual([])
  })

  it('grain none gives one row per goal at its saved amount', async () => {
    const eur = account({ currency: 'EUR', balance: 10_000 })
    const usd = account({ currency: 'USD' })
    txn(usd, { amount: 20_000, posted: noon(2026, 8, 1) })
    const first = await makeGoal([eur], { name: 'Euro', mode: 'balance' })
    const second = await makeGoal([usd], { name: 'Dollar' })
    const archived = await makeGoal([usd], { name: 'Old' })
    await api.goals.update({ id: archived.id, archived: true })

    const result = await api.goals.series({
      goalIds: undefined,
      timeGrain: 'none',
      dateStart: null,
      dateEnd: null
    })

    const mine = result.rows.filter((r) => [first.id, second.id, archived.id].includes(r.groupId!))
    expect(mine).toEqual([
      { bucket: null, groupId: first.id, groupLabel: 'Euro', currency: 'EUR', value: 10_000 },
      { bucket: null, groupId: second.id, groupLabel: 'Dollar', currency: 'USD', value: 20_000 }
    ])
    expect(result.currencies).toEqual(expect.arrayContaining(['EUR', 'USD']))
  })

  describe('monthly buckets', () => {
    // started July 10; +100k Jul 20, +50k Aug 10, +25k Sep 5, so 175k saved now
    const contributionsFlows = (a: number): void => {
      txn(a, { amount: 100_000, posted: noon(2026, 7, 20) })
      txn(a, { amount: 50_000, posted: noon(2026, 8, 10) })
      txn(a, { amount: 25_000, posted: noon(2026, 9, 5) })
    }

    it('walks from the goal start to the current month, ending on the saved amount', async () => {
      const a = account()
      contributionsFlows(a)
      const goal = await makeGoal([a], { startedAt: noon(2026, 7, 10) })

      const result = await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'month',
        dateStart: null,
        dateEnd: null
      })

      expect(pointsOf(result.rows, goal.id)).toEqual([
        ['2026-07', 100_000],
        ['2026-08', 150_000],
        ['2026-09', 175_000]
      ])
      expect(result.currencies).toEqual(['USD'])
    })

    it('drops buckets after dateEnd without disturbing earlier values', async () => {
      const a = account()
      contributionsFlows(a)
      const goal = await makeGoal([a], { startedAt: noon(2026, 7, 10) })

      const result = await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'month',
        dateStart: null,
        dateEnd: noon(2026, 8, 20)
      })

      expect(pointsOf(result.rows, goal.id)).toEqual([
        ['2026-07', 100_000],
        ['2026-08', 150_000]
      ])
    })

    it('a contributions goal drops buckets from before it started; a balance goal keeps them', async () => {
      const a = account({ balance: 200_000 })
      txn(a, { amount: 10_000, posted: noon(2026, 5, 15) })
      contributionsFlows(a)
      const contributions = await makeGoal([a], { startedAt: noon(2026, 7, 10) })
      const balance = await makeGoal([a], { mode: 'balance', startedAt: noon(2026, 7, 10) })

      const result = await api.goals.series({
        goalIds: [contributions.id, balance.id],
        timeGrain: 'month',
        dateStart: noon(2026, 5, 1),
        dateEnd: null
      })

      expect(pointsOf(result.rows, contributions.id).map(([bucket]) => bucket)).toEqual([
        '2026-07',
        '2026-08',
        '2026-09'
      ])
      // 200k anchor + 10k + 175k = 385k now; each bucket backs out what came after it
      expect(pointsOf(result.rows, balance.id)).toEqual([
        ['2026-05', 210_000],
        ['2026-06', 210_000],
        ['2026-07', 310_000],
        ['2026-08', 360_000],
        ['2026-09', 385_000]
      ])
    })

    it('honors dateStart as the first bucket', async () => {
      const a = account({ balance: 50_000 })
      contributionsFlows(a)
      const goal = await makeGoal([a], { mode: 'balance', startedAt: noon(2026, 7, 10) })

      const result = await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'month',
        dateStart: noon(2026, 8, 1),
        dateEnd: null
      })

      expect(pointsOf(result.rows, goal.id)).toEqual([
        ['2026-08', 200_000],
        ['2026-09', 225_000]
      ])
    })

    it('uses every active goal when goalIds is omitted', async () => {
      const a = account()
      const goal = await makeGoal([a], { startedAt: noon(2026, 9, 1) })
      const result = await api.goals.series({
        goalIds: undefined,
        timeGrain: 'month',
        dateStart: null,
        dateEnd: null
      })
      expect(pointsOf(result.rows, goal.id)).toEqual([['2026-09', 0]])
    })

    it('labels other grains the way the report system does', async () => {
      const a = account()
      txn(a, { amount: 10_000, posted: noon(2026, 9, 10) })
      const goal = await makeGoal([a], { startedAt: noon(2026, 8, 1) })
      const quarter = await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'quarter',
        dateStart: null,
        dateEnd: null
      })
      expect(pointsOf(quarter.rows, goal.id)).toEqual([['2026-Q3', 10_000]])
      const year = await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'year',
        dateStart: null,
        dateEnd: null
      })
      expect(pointsOf(year.rows, goal.id)).toEqual([['2026', 10_000]])
      const week = await api.goals.series({
        goalIds: [goal.id],
        timeGrain: 'week',
        dateStart: noon(2026, 9, 7),
        dateEnd: null
      })
      // Monday-based weeks: Sep 7 and Sep 14
      expect(pointsOf(week.rows, goal.id)).toEqual([
        ['2026-09-07', 10_000],
        ['2026-09-14', 10_000]
      ])
    })
  })
})
