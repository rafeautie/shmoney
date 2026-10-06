import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Rule, RuleConditions } from '@shared/rules'
import { db } from '../../demo/db'
import { rules } from '../db/schema'
import { api } from './harness/api'
import { account, category, noon, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'
import { expectUndoRoundTrip } from './harness/undo'

let checking: number
let savings: number

type TxnOver = Parameters<typeof txn>[1]

const categoryOf = (id: number): number | null =>
  query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c

const setCategory = (categoryId: number): { type: 'setCategory'; categoryId: number } => ({
  type: 'setCategory',
  categoryId
})

const createRule = (name: string, conditions: RuleConditions, categoryId: number): Promise<Rule> =>
  api.rules.create({ name, conditions, action: setCategory(categoryId) })

const contains = (...phrases: string[]): RuleConditions => ({
  description: { op: 'contains', phrases }
})

/**
 * Files `rows` under a fresh category with one rule over `conditions`, applies
 * it, and says which rows the rule claimed, in row order.
 */
async function claims(conditions: RuleConditions, rows: TxnOver[]): Promise<boolean[]> {
  // one rule at a time, so a test can call this more than once
  db.delete(rules).run()
  const target = category()
  await createRule('Semantics', conditions, target)
  const ids = rows.map((over) => txn(checking, over))
  await api.rules.apply()
  return ids.map((id) => categoryOf(id) === target)
}

beforeAll(() => {
  checking = account({ name: 'Rules checking' })
  savings = account({ name: 'Rules savings' })
})

// every test starts from an empty rule set, so apply only runs its own rules
beforeEach(() => {
  db.delete(rules).run()
})

describe('rules create', () => {
  it('appends priority and defaults to enabled', async () => {
    const target = category()
    const first = await createRule('First', contains('a'), target)
    const second = await createRule('Second', contains('b'), target)
    expect(first).toMatchObject({ name: 'First', enabled: true, priority: 0 })
    expect(second).toMatchObject({ enabled: true, priority: 1 })
  })

  it('stores the conditions and action it was given', async () => {
    const target = category()
    const conditions: RuleConditions = {
      description: { op: 'equals', phrases: ['x', 'y'] },
      amount: { op: 'gte', value: 5000, direction: 'out' },
      accountId: checking
    }
    const created = await createRule('Stored', conditions, target)
    expect(created.conditions).toEqual(conditions)
    expect(created.action).toEqual(setCategory(target))
    expect(await api.rules.list()).toEqual([created])
  })

  it('rejects a rule with no condition', async () => {
    await expect(createRule('Empty', {}, category())).rejects.toThrow(/at least one condition/)
  })

  it('rejects a between amount without a second value', async () => {
    await expect(
      createRule('No upper', { amount: { op: 'between', value: 1000 } }, category())
    ).rejects.toThrow(/second value/)
  })

  it('rejects a between amount whose second value is below the first', async () => {
    await expect(
      createRule('Backwards', { amount: { op: 'between', value: 2000, value2: 1000 } }, category())
    ).rejects.toThrow(/second value/)
  })

  it('rejects a date condition with no bound', async () => {
    await expect(createRule('No bound', { date: {} }, category())).rejects.toThrow(
      /at least one bound/
    )
  })

  it('rejects an empty phrase list and a blank phrase', async () => {
    const target = category()
    await expect(createRule('No phrases', contains(), target)).rejects.toThrow()
    await expect(createRule('Blank phrase', contains('   '), target)).rejects.toThrow()
  })

  it('rejects a blank name', async () => {
    await expect(createRule('  ', contains('a'), category())).rejects.toThrow()
  })

  it.todo(
    'TRIAGE: rules.create accepts an action whose target category does not exist (src/main/ipc/rules.ts:343, no existence check; the rules table has no FK)'
  )
})

describe('rules list, update and reorder', () => {
  it('lists in priority order, ties broken by id', async () => {
    const target = category()
    const a = await createRule('A', contains('a'), target)
    const b = await createRule('B', contains('b'), target)
    const c = await createRule('C', contains('c'), target)
    db.update(rules).set({ priority: 5 }).run()
    expect((await api.rules.list()).map((r) => r.id)).toEqual([a.id, b.id, c.id])
  })

  it('reorder rewrites priorities to the given order', async () => {
    const target = category()
    const a = await createRule('A', contains('a'), target)
    const b = await createRule('B', contains('b'), target)
    const c = await createRule('C', contains('c'), target)

    expect(await api.rules.reorder({ orderedIds: [c.id, a.id, b.id] })).toBe(true)

    const listed = await api.rules.list()
    expect(listed.map((r) => [r.id, r.priority])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2]
    ])
  })

  it.todo(
    'TRIAGE: reorder with a partial id list leaves the omitted rules at their old priority, so priorities collide (src/main/ipc/rules.ts:406-414)'
  )

  it('toggles enabled through update and keeps everything else', async () => {
    const target = category()
    const created = await createRule('Toggle me', contains('toggle'), target)

    const off = await api.rules.update({ id: created.id, enabled: false })
    expect(off).toMatchObject({ enabled: false, name: 'Toggle me', priority: created.priority })
    expect(off.conditions).toEqual(created.conditions)
    expect((await api.rules.list())[0].enabled).toBe(false)

    expect((await api.rules.update({ id: created.id, enabled: true })).enabled).toBe(true)
  })

  it('update changes only the fields it is given', async () => {
    const target = category()
    const other = category()
    const created = await createRule('Before', contains('old'), target)

    const renamed = await api.rules.update({ id: created.id, name: 'After' })
    expect(renamed).toMatchObject({ name: 'After', action: setCategory(target) })

    const retargeted = await api.rules.update({
      id: created.id,
      conditions: contains('new'),
      action: setCategory(other)
    })
    expect(retargeted).toMatchObject({
      name: 'After',
      conditions: contains('new'),
      action: setCategory(other)
    })
  })

  it('update of an unknown rule fails', async () => {
    await expect(api.rules.update({ id: 999_999, enabled: false })).rejects.toThrow(
      'Rule 999999 not found'
    )
  })

  it('update refuses conditions that fail the schema', async () => {
    const created = await createRule('Keep', contains('keep'), category())
    await expect(api.rules.update({ id: created.id, conditions: {} })).rejects.toThrow()
    expect((await api.rules.list())[0].conditions).toEqual(contains('keep'))
  })
})

describe('rules delete', () => {
  it('round-trips through undo and redo', async () => {
    const created = await createRule('Doomed', contains('doomed'), category())
    await expectUndoRoundTrip(() => api.rules.delete(created.id))
    expect(count('rules', `id = ${created.id}`)).toBe(0)
  })

  it('returns null for an unknown rule and logs nothing', async () => {
    const before = count('action_log')
    expect(await api.rules.delete(999_999)).toBeNull()
    expect(count('action_log')).toBe(before)
  })

  it('undo skips a rule whose target category was deleted since', async () => {
    const target = category()
    const created = await createRule('Orphan on undo', contains('orphan'), target)
    const actionId = (await api.rules.delete(created.id))!
    await api.categories.delete(target)

    const undone = await api.actionLog.undoEntry(actionId)
    expect(undone.applied).toBe(0)
    expect(count('rules', `id = ${created.id}`)).toBe(0)
  })
})

describe('description conditions', () => {
  it('contains matches a substring, ignoring case', async () => {
    expect(
      await claims(contains('starbucks'), [
        { description: 'POS STARBUCKS #1082' },
        { description: 'Starbucks' },
        { description: 'Dunkin' }
      ])
    ).toEqual([true, true, false])
  })

  it('equals matches the whole description, ignoring case', async () => {
    expect(
      await claims({ description: { op: 'equals', phrases: ['netflix'] } }, [
        { description: 'NETFLIX' },
        { description: 'Netflix.com' }
      ])
    ).toEqual([true, false])
  })

  it('matches any of several phrases', async () => {
    expect(
      await claims(contains('hulu', 'disney'), [
        { description: 'HULU 1234' },
        { description: 'DISNEY PLUS' },
        { description: 'HBO' }
      ])
    ).toEqual([true, true, false])
  })

  it('treats LIKE wildcards in a phrase literally', async () => {
    expect(
      await claims(contains('50%_off'), [
        { description: 'SALE 50%_OFF TODAY' },
        { description: 'SALE 500XOFF TODAY' }
      ])
    ).toEqual([true, false])
  })
})

describe('amount conditions', () => {
  it('compares the absolute value, so either sign matches', async () => {
    expect(
      await claims({ amount: { op: 'eq', value: 12_000 } }, [
        { amount: -12_000 },
        { amount: 12_000 },
        { amount: -12_001 }
      ])
    ).toEqual([true, true, false])
  })

  it('gt and lt are strict', async () => {
    expect(
      await claims({ amount: { op: 'gt', value: 5000 } }, [
        { amount: -5000 },
        { amount: -5001 },
        { amount: 9000 }
      ])
    ).toEqual([false, true, true])
    expect(
      await claims({ amount: { op: 'lt', value: 5000 } }, [
        { amount: -5000 },
        { amount: -4999 },
        { amount: 100 }
      ])
    ).toEqual([false, true, true])
  })

  it('gte and lte are inclusive', async () => {
    expect(
      await claims({ amount: { op: 'gte', value: 5000 } }, [{ amount: -5000 }, { amount: -4999 }])
    ).toEqual([true, false])
    expect(
      await claims({ amount: { op: 'lte', value: 5000 } }, [{ amount: -5000 }, { amount: -5001 }])
    ).toEqual([true, false])
  })

  it('between includes both ends', async () => {
    expect(
      await claims({ amount: { op: 'between', value: 2000, value2: 4000 } }, [
        { amount: -1999 },
        { amount: -2000 },
        { amount: -3000 },
        { amount: 4000 },
        { amount: -4001 }
      ])
    ).toEqual([false, true, true, true, false])
  })

  it('direction out matches only money out', async () => {
    expect(
      await claims({ amount: { op: 'gte', value: 1000, direction: 'out' } }, [
        { amount: -2000 },
        { amount: 2000 }
      ])
    ).toEqual([true, false])
  })

  it('direction in matches only money in', async () => {
    expect(
      await claims({ amount: { op: 'gte', value: 1000, direction: 'in' } }, [
        { amount: -2000 },
        { amount: 2000 }
      ])
    ).toEqual([false, true])
  })
})

describe('date conditions', () => {
  it('after and before are inclusive bounds', async () => {
    const conditions: RuleConditions = {
      date: { after: noon(2026, 3, 10), before: noon(2026, 3, 20) }
    }
    expect(
      await claims(conditions, [
        { posted: noon(2026, 3, 9) },
        { posted: noon(2026, 3, 10) },
        { posted: noon(2026, 3, 15) },
        { posted: noon(2026, 3, 20) },
        { posted: noon(2026, 3, 21) }
      ])
    ).toEqual([false, true, true, true, false])
  })

  it('day-of-month window follows the local calendar', async () => {
    expect(
      await claims({ date: { dayOfMonthMin: 1, dayOfMonthMax: 3 } }, [
        { posted: noon(2026, 4, 1) },
        { posted: noon(2026, 4, 3) },
        { posted: noon(2026, 4, 4) },
        { posted: noon(2026, 5, 2) }
      ])
    ).toEqual([true, true, false, true])
  })

  it('falls back to the transacted date when posted is unknown', async () => {
    expect(
      await claims({ date: { after: noon(2026, 6, 1) } }, [
        { posted: 0, transactedAt: noon(2026, 6, 5) },
        { posted: 0, transactedAt: noon(2026, 5, 5) }
      ])
    ).toEqual([true, false])
  })

  it('a row with an unknown date never matches a date condition', async () => {
    expect(
      await claims({ date: { before: noon(2099, 1, 1) } }, [
        { posted: 0, transactedAt: null },
        { posted: noon(2026, 1, 1) }
      ])
    ).toEqual([false, true])
  })
})

describe('account and combined conditions', () => {
  it('matches only the named account', async () => {
    const target = category()
    await createRule('Account only', { accountId: savings }, target)
    const inSavings = txn(savings)
    const inChecking = txn(checking)
    await api.rules.apply()
    expect(categoryOf(inSavings)).toBe(target)
    expect(categoryOf(inChecking)).toBeNull()
  })

  it('ANDs every condition together', async () => {
    const target = category()
    await createRule(
      'All of it',
      {
        description: { op: 'contains', phrases: ['gym'] },
        amount: { op: 'gte', value: 20_000, direction: 'out' },
        accountId: checking
      },
      target
    )
    const hit = txn(checking, { description: 'City Gym', amount: -25_000 })
    const wrongText = txn(checking, { description: 'City Pool', amount: -25_000 })
    const wrongAmount = txn(checking, { description: 'City Gym', amount: -5000 })
    const wrongDirection = txn(checking, { description: 'City Gym', amount: 25_000 })
    const wrongAccount = txn(savings, { description: 'City Gym', amount: -25_000 })
    await api.rules.apply()

    expect(categoryOf(hit)).toBe(target)
    for (const id of [wrongText, wrongAmount, wrongDirection, wrongAccount]) {
      expect(categoryOf(id)).toBeNull()
    }
  })
})

describe('apply', () => {
  it('lets the lowest priority rule claim a row first', async () => {
    const first = category()
    const second = category()
    await createRule('Wins', contains('priority-a'), first)
    await createRule('Loses', contains('priority-a'), second)
    const t = txn(checking, { description: 'priority-a coffee' })

    const result = await api.rules.apply()
    expect(categoryOf(t)).toBe(first)
    expect(result).toEqual({ categorized: 1, rulesFired: 1 })
  })

  it('reordering changes which rule wins', async () => {
    const first = category()
    const second = category()
    const a = await createRule('A', contains('priority-b'), first)
    const b = await createRule('B', contains('priority-b'), second)
    await api.rules.reorder({ orderedIds: [b.id, a.id] })
    const t = txn(checking, { description: 'priority-b coffee' })

    await api.rules.apply()
    expect(categoryOf(t)).toBe(second)
  })

  it('by default only fills uncategorized rows', async () => {
    const mine = category()
    const target = category()
    await createRule('Fill', contains('fill-only'), target)
    const blank = txn(checking, { description: 'fill-only 1' })
    const filed = txn(checking, { description: 'fill-only 2', categoryId: mine })

    await api.rules.apply()
    expect(categoryOf(blank)).toBe(target)
    expect(categoryOf(filed)).toBe(mine)
  })

  it('overrideCategories overwrites an existing category', async () => {
    const mine = category()
    const target = category()
    await createRule('Overwrite', contains('overwrite-me'), target)
    const filed = txn(checking, { description: 'overwrite-me', categoryId: mine })

    const result = await api.rules.apply({ overrideCategories: true })
    expect(categoryOf(filed)).toBe(target)
    expect(result).toEqual({ categorized: 1, rulesFired: 1 })
  })

  it('overrideCategories never touches Transfers or Starting balance rows', async () => {
    const target = category()
    await createRule('Spare the system', contains('spare-system'), target)
    const transfer = txn(checking, {
      description: 'spare-system transfer',
      categoryId: systemCategory('transfers')
    })
    const opening = txn(checking, {
      description: 'spare-system opening',
      categoryId: systemCategory('opening')
    })
    const income = txn(checking, {
      description: 'spare-system income',
      categoryId: systemCategory('income')
    })

    await api.rules.apply({ overrideCategories: true })
    expect(categoryOf(transfer)).toBe(systemCategory('transfers'))
    expect(categoryOf(opening)).toBe(systemCategory('opening'))
    // Income is an ordinary system category for this purpose
    expect(categoryOf(income)).toBe(target)
  })

  it('skips disabled rules', async () => {
    const target = category()
    const created = await createRule('Disabled', contains('disabled-rule'), target)
    await api.rules.update({ id: created.id, enabled: false })
    const t = txn(checking, { description: 'disabled-rule' })

    expect(await api.rules.apply()).toEqual({ categorized: 0, rulesFired: 0 })
    expect(categoryOf(t)).toBeNull()
  })

  it('skips pending and soft-deleted rows', async () => {
    const target = category()
    await createRule('Live only', contains('live-only'), target)
    const pending = txn(checking, { description: 'live-only pending', pending: true })
    const deleted = txn(checking, { description: 'live-only deleted', deletedAt: 1_700_000_000 })
    const live = txn(checking, { description: 'live-only live' })

    await api.rules.apply()
    expect(categoryOf(pending)).toBeNull()
    expect(categoryOf(deleted)).toBeNull()
    expect(categoryOf(live)).toBe(target)
  })

  it('logs one rule entry per firing rule inside one apply-rules run', async () => {
    const food = category()
    const fuel = category()
    const unused = category()
    await createRule('Food', contains('run-food'), food)
    await createRule('Fuel', contains('run-fuel'), fuel)
    await createRule('Unused', contains('run-nothing-matches'), unused)
    const a = txn(checking, { description: 'run-food 1' })
    const b = txn(checking, { description: 'run-food 2' })
    const c = txn(checking, { description: 'run-fuel 1' })
    const newest = query<{ id: number | null }>('SELECT max(id) AS id FROM action_log')[0].id ?? 0

    const result = await api.rules.apply()
    expect(result).toEqual({ categorized: 3, rulesFired: 2 })

    const entries = query<{ source: string; label: string; run_id: number }>(
      `SELECT source, label, run_id FROM action_log WHERE id > ${newest} ORDER BY id`
    )
    expect(entries.map((e) => e.source)).toEqual(['rule', 'rule'])
    expect(entries.map((e) => e.label)).toEqual([
      'Rule "Food" categorized 2 transactions',
      'Rule "Fuel" categorized 1 transaction'
    ])
    const runId = entries[0].run_id
    expect(entries[1].run_id).toBe(runId)
    expect(query(`SELECT trigger, label FROM action_runs WHERE id = ${runId}`)).toEqual([
      { trigger: 'apply-rules', label: 'Apply rules' }
    ])

    const undone = await api.actionLog.undoRun(runId)
    expect(undone).toMatchObject({ runId, entries: 2, applied: 3 })
    for (const id of [a, b, c]) expect(categoryOf(id)).toBeNull()

    const redone = await api.actionLog.redoRun(runId)
    expect(redone.applied).toBe(3)
    expect([categoryOf(a), categoryOf(b), categoryOf(c)]).toEqual([food, food, fuel])
  })

  it('writes no run when nothing matched', async () => {
    await createRule('Nothing', contains('matches-nothing-at-all'), category())
    const runs = count('action_runs')
    expect(await api.rules.apply()).toEqual({ categorized: 0, rulesFired: 0 })
    expect(count('action_runs')).toBe(runs)
  })

  it('does not log a no-op when override finds rows already at the target', async () => {
    const target = category()
    await createRule('Already there', contains('already-there'), target)
    txn(checking, { description: 'already-there', categoryId: target })
    const entries = count('action_log')

    expect(await api.rules.apply({ overrideCategories: true })).toEqual({
      categorized: 0,
      rulesFired: 0
    })
    expect(count('action_log')).toBe(entries)
  })
})

describe('preview', () => {
  it('reports what apply would do and writes nothing', async () => {
    const target = category()
    await createRule('Preview me', contains('preview-me'), target)
    const t = txn(checking, { description: 'preview-me latte', amount: -4500 })
    const entries = count('action_log')
    const runs = count('action_runs')

    const preview = await api.rules.preview()

    expect(preview).toHaveLength(1)
    expect(preview[0]).toMatchObject({ ruleName: 'Preview me', total: 1 })
    expect(preview[0].transactions[0]).toMatchObject({
      id: t,
      description: 'preview-me latte',
      amount: -4500,
      accountName: 'Rules checking',
      currentCategoryName: null
    })
    expect(categoryOf(t)).toBeNull()
    expect(count('action_log')).toBe(entries)
    expect(count('action_runs')).toBe(runs)
  })

  it('omits rules that would change nothing', async () => {
    await createRule('Quiet', contains('preview-quiet-nothing'), category())
    const target = category()
    await createRule('Loud', contains('preview-loud'), target)
    txn(checking, { description: 'preview-loud' })

    expect((await api.rules.preview()).map((g) => g.ruleName)).toEqual(['Loud'])
  })

  it('returns nothing when no rule would fire', async () => {
    await createRule('Quiet', contains('preview-quiet-nothing'), category())
    expect(await api.rules.preview()).toEqual([])
  })

  it('under override shows the category being replaced and skips rows already at the target', async () => {
    const mine = category('Preview current')
    const target = category('Preview target')
    await createRule('Replace', contains('preview-replace'), target)
    txn(checking, { description: 'preview-replace 1', categoryId: mine })
    txn(checking, { description: 'preview-replace 2', categoryId: target })

    expect(await api.rules.preview()).toEqual([])
    const preview = await api.rules.preview({ overrideCategories: true })
    expect(preview).toHaveLength(1)
    expect(preview[0].total).toBe(1)
    expect(preview[0].transactions[0]).toMatchObject({
      currentCategoryName: 'Preview current',
      targetCategoryName: 'Preview target'
    })
  })

  it('first match claims the row in preview too', async () => {
    const first = category()
    const second = category()
    await createRule('Wins', contains('preview-claim'), first)
    await createRule('Loses', contains('preview-claim'), second)
    txn(checking, { description: 'preview-claim' })

    expect((await api.rules.preview()).map((g) => g.ruleName)).toEqual(['Wins'])
  })
})
