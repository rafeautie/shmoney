import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ImportApplyResult } from '@shared/import'
import { db } from '../../demo/db'
import { DEFAULT_CATEGORY_GROUPS } from '../db/defaults'
import { ruleSuggestions } from '../db/schema'
import { api } from './harness/api'
import { account, category, group, noon, rule, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'

let checking: number

const MAPPING = {
  dateColumn: 0,
  dateFormat: 'MM/dd/yyyy',
  descriptionColumn: 1,
  amount: { kind: 'single' as const, column: 2, invert: false }
}

/** imports `rows` (date, description, amount in dollars) into an existing account */
async function importInto(
  accountId: number,
  rows: [string, string, string][]
): Promise<ImportApplyResult> {
  const text = ['Date,Description,Amount', ...rows.map((r) => r.join(','))].join('\n')
  const file = await api.import.pickFile({
    dropped: { fileName: 'bank.csv', bytes: new TextEncoder().encode(text) }
  })
  if (!file) throw new Error('canceled')
  return api.import.apply({
    handle: file.handle,
    mapping: MAPPING,
    excluded: [],
    target: { accountId }
  })
}

const importedRow = (accountId: number, description: string): number =>
  query<{ id: number }>(
    `SELECT id FROM transactions WHERE account_id = ${accountId} AND description = '${description}'`
  )[0].id

const categoryOf = (id: number): number | null =>
  query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c

beforeAll(() => {
  checking = account({ name: 'Checking' })
})

describe('categories list', () => {
  it('splits groups, ungrouped and system categories', async () => {
    const g = group('List group')
    const inGroup = category('In group', g)
    const loose = category('Loose one')

    const list = await api.categories.list()
    expect(list.groups.find((x) => x.id === g)?.categories.map((c) => c.id)).toEqual([inGroup])
    expect(list.ungrouped.map((c) => c.id)).toContain(loose)
    expect(list.system.map((c) => c.systemKey).sort()).toEqual(['income', 'opening', 'transfers'])
  })

  it('keeps system categories out of groups and ungrouped', async () => {
    const list = await api.categories.list()
    const systemIds = new Set(list.system.map((c) => c.id))
    expect(list.ungrouped.some((c) => systemIds.has(c.id))).toBe(false)
    expect(list.groups.some((g) => g.categories.some((c) => systemIds.has(c.id)))).toBe(false)
  })

  it("sorts a group's categories by name", async () => {
    const g = group('Sorted group')
    category('Zeta', g)
    category('Alpha', g)
    const list = await api.categories.list()
    expect(list.groups.find((x) => x.id === g)?.categories.map((c) => c.name)).toEqual([
      'Alpha',
      'Zeta'
    ])
  })
})

describe('category groups', () => {
  it('creates a group with no categories', async () => {
    const created = await api.categories.createGroup({ name: 'Brand new' })
    expect(created).toMatchObject({ name: 'Brand new', categories: [] })
    expect(count('category_groups', `id = ${created.id}`)).toBe(1)
  })

  it('rejects a duplicate group name', async () => {
    await api.categories.createGroup({ name: 'Dup group' })
    await expect(api.categories.createGroup({ name: 'Dup group' })).rejects.toThrow(
      'A group named "Dup group" already exists'
    )
  })

  it('renames a group', async () => {
    const g = group('Before rename')
    expect(await api.categories.renameGroup({ id: g, name: 'After rename' })).toBe(true)
    expect(query(`SELECT name FROM category_groups WHERE id = ${g}`)).toEqual([
      { name: 'After rename' }
    ])
  })

  it('rejects renaming a group onto another group name', async () => {
    group('Taken group name')
    const g = group('Renamer')
    await expect(api.categories.renameGroup({ id: g, name: 'Taken group name' })).rejects.toThrow(
      'A group named "Taken group name" already exists'
    )
  })

  it('rejects renaming an unknown group', async () => {
    await expect(api.categories.renameGroup({ id: 999_999, name: 'Whoever' })).rejects.toThrow(
      'Group not found'
    )
  })
})

describe('category create and rename', () => {
  it('creates a category in a group and an ungrouped one', async () => {
    const g = group('Create group')
    const inGroup = await api.categories.create({ groupId: g, name: 'Grouped cat' })
    const loose = await api.categories.create({ groupId: null, name: 'Ungrouped cat' })
    expect(inGroup).toMatchObject({ groupId: g, name: 'Grouped cat', systemKey: null })
    expect(loose).toMatchObject({ groupId: null, name: 'Ungrouped cat', systemKey: null })
  })

  it('rejects a duplicate name in the same group', async () => {
    const g = group('Dup cat group')
    category('Twin', g)
    await expect(api.categories.create({ groupId: g, name: 'Twin' })).rejects.toThrow(
      'A category named "Twin" already exists in this group'
    )
  })

  it('allows the same name in different groups', async () => {
    const a = group('Same name A')
    const b = group('Same name B')
    category('Shared name', a)
    await expect(api.categories.create({ groupId: b, name: 'Shared name' })).resolves.toBeTruthy()
  })

  it('rejects a duplicate ungrouped name', async () => {
    category('Ungrouped twin')
    await expect(api.categories.create({ groupId: null, name: 'Ungrouped twin' })).rejects.toThrow(
      'An ungrouped category named "Ungrouped twin" already exists'
    )
  })

  it('rejects an ungrouped category named like a system category', async () => {
    const transfers = (await api.categories.list()).system.find((c) => c.systemKey === 'transfers')!
    await expect(api.categories.create({ groupId: null, name: transfers.name })).rejects.toThrow(
      /already exists/
    )
  })

  it('renames a category', async () => {
    const id = category('Old name')
    expect(await api.categories.rename({ id, name: 'New name' })).toBe(true)
    expect(query(`SELECT name FROM categories WHERE id = ${id}`)).toEqual([{ name: 'New name' }])
  })

  it('rejects a rename onto a sibling name', async () => {
    const g = group('Rename clash group')
    category('Sibling', g)
    const id = category('Mover', g)
    await expect(api.categories.rename({ id, name: 'Sibling' })).rejects.toThrow(
      'A category named "Sibling" already exists in this group'
    )
  })

  it('rejects renaming an unknown category', async () => {
    await expect(api.categories.rename({ id: 999_999, name: 'Nobody' })).rejects.toThrow(
      'Category not found'
    )
  })

  it('refuses to rename a system category', async () => {
    const id = systemCategory('income')
    await expect(api.categories.rename({ id, name: 'Salary' })).rejects.toThrow(
      "System categories can't be changed"
    )
    expect(count('categories', `id = ${id} AND name = 'Salary'`)).toBe(0)
  })
})

describe('category delete', () => {
  it('refuses to delete a system category', async () => {
    const id = systemCategory('transfers')
    await expect(api.categories.delete(id)).rejects.toThrow("System categories can't be changed")
    expect(count('categories', `id = ${id}`)).toBe(1)
  })

  it('returns null for an unknown category and logs nothing', async () => {
    const before = count('action_log')
    expect(await api.categories.delete(999_999)).toBeNull()
    expect(count('action_log')).toBe(before)
  })

  it('returns null for an unknown group', async () => {
    expect(await api.categories.deleteGroup(999_999)).toBeNull()
  })

  it('uncategorizes the rows and prunes the rules of a deleted category', async () => {
    const c = category('Doomed')
    const t = txn(checking, { categoryId: c })
    const r = rule('Doomed rule', 'doomed', c)

    await api.categories.delete(c)
    expect(categoryOf(t)).toBeNull()
    expect(count('rules', `id = ${r}`)).toBe(0)
  })

  it('undo is skipped when a category of the same name was created since', async () => {
    const c = category('Clashing')
    const t = txn(checking, { categoryId: c })
    const actionId = (await api.categories.delete(c))!

    const replacement = await api.categories.create({ groupId: null, name: 'Clashing' })
    const undone = await api.actionLog.undoEntry(actionId)

    expect(undone.applied).toBe(0)
    expect(count('categories', `id = ${c}`)).toBe(0)
    expect(query(`SELECT id FROM categories WHERE name = 'Clashing'`)).toEqual([
      { id: replacement.id }
    ])
    expect(categoryOf(t)).toBeNull()
  })

  it("undo is skipped when the category's group is gone", async () => {
    const g = group('Vanishing group')
    const c = category('Orphan to be', g)
    const actionId = (await api.categories.delete(c))!
    await api.categories.deleteGroup(g)

    const undone = await api.actionLog.undoEntry(actionId)
    expect(undone.applied).toBe(0)
    expect(count('categories', `id = ${c}`)).toBe(0)
  })

  it('group undo is skipped when a group of the same name exists', async () => {
    const g = group('Group clash')
    const c = category('Inside clash group', g)
    const actionId = (await api.categories.deleteGroup(g))!
    await api.categories.createGroup({ name: 'Group clash' })

    const undone = await api.actionLog.undoEntry(actionId)
    expect(undone.applied).toBe(0)
    expect(count('categories', `id = ${c}`)).toBe(0)
  })

  it("undo restores the category's suggestions along with it", async () => {
    const c = category('Suggested cat')
    db.insert(ruleSuggestions)
      .values({
        descriptionKey: 'SUGGESTED THING',
        phrase: 'SUGGESTED THING',
        categoryId: c,
        matchCount: 3,
        source: 'user',
        status: 'pending',
        createdAt: 1,
        updatedAt: 1
      })
      .run()

    const actionId = (await api.categories.delete(c))!
    expect(count('rule_suggestions', `category_id = ${c}`)).toBe(0)

    await api.actionLog.undoEntry(actionId)
    expect(query(`SELECT phrase, status FROM rule_suggestions WHERE category_id = ${c}`)).toEqual([
      { phrase: 'SUGGESTED THING', status: 'pending' }
    ])
  })
})

describe('transfer detection on import', () => {
  afterEach(async () => {
    await api.settings.set('detectTransfers', true)
  })

  it('files an equal and opposite pair in two accounts under Transfers', async () => {
    const from = account({ name: 'Xfer from' })
    const to = account({ name: 'Xfer to' })
    const transfers = systemCategory('transfers')

    await importInto(from, [['03/04/2024', 'Out leg', '-731.00']])
    const result = await importInto(to, [['03/06/2024', 'In leg', '731.00']])

    expect(result.detectedTransfers).toBe(1)
    expect(categoryOf(importedRow(from, 'Out leg'))).toBe(transfers)
    expect(categoryOf(importedRow(to, 'In leg'))).toBe(transfers)
    expect(count('action_log', "source = 'detector'")).toBeGreaterThan(0)
  })

  it('undoing the detector entry unmarks both legs', async () => {
    const from = account({ name: 'Undo from' })
    const to = account({ name: 'Undo to' })
    await importInto(from, [['04/04/2024', 'Undo out', '-612.00']])
    await importInto(to, [['04/04/2024', 'Undo in', '612.00']])
    const detector = query<{ id: number }>(
      "SELECT max(id) AS id FROM action_log WHERE source = 'detector'"
    )[0].id

    await api.actionLog.undoEntry(detector)
    expect(categoryOf(importedRow(from, 'Undo out'))).toBeNull()
    expect(categoryOf(importedRow(to, 'Undo in'))).toBeNull()
  })

  it('leaves legs more than three days apart alone', async () => {
    const from = account()
    const to = account()
    await importInto(from, [['05/01/2024', 'Far out', '-523.00']])
    const result = await importInto(to, [['05/05/2024', 'Far in', '523.00']])

    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(importedRow(from, 'Far out'))).toBeNull()
    expect(categoryOf(importedRow(to, 'Far in'))).toBeNull()
  })

  it('does not pair two legs inside one account', async () => {
    const only = account()
    const result = await importInto(only, [
      ['06/01/2024', 'Same out', '-444.00'],
      ['06/01/2024', 'Same in', '444.00']
    ])
    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(importedRow(only, 'Same out'))).toBeNull()
  })

  it('does not pair amounts across currencies', async () => {
    const usd = account({ currency: 'USD' })
    const eur = account({ currency: 'EUR' })
    await importInto(usd, [['07/01/2024', 'Dollar leg', '-333.00']])
    const result = await importInto(eur, [['07/01/2024', 'Euro leg', '333.00']])
    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(importedRow(eur, 'Euro leg'))).toBeNull()
  })

  it('leaves an ambiguous leg alone when two candidates could pair with it', async () => {
    const a = account()
    const b = account()
    const c = account()
    const out = txn(a, { posted: noon(2024, 8, 1), amount: -222_000, description: 'Ambig out' })
    const first = txn(b, { posted: noon(2024, 8, 1), amount: 222_000, description: 'Ambig in 1' })

    const result = await importInto(c, [['08/02/2024', 'Ambig in 2', '222.00']])

    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(out)).toBeNull()
    expect(categoryOf(first)).toBeNull()
    expect(categoryOf(importedRow(c, 'Ambig in 2'))).toBeNull()
  })

  it('never overwrites a category the user already set', async () => {
    const from = account()
    const to = account()
    const rent = category('Pair rent')
    const out = txn(from, {
      posted: noon(2024, 9, 1),
      amount: -111_000,
      description: 'Filed out',
      categoryId: rent
    })

    const result = await importInto(to, [['09/01/2024', 'Filed in', '111.00']])

    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(out)).toBe(rent)
    expect(categoryOf(importedRow(to, 'Filed in'))).toBeNull()
  })

  it('marks nothing when detectTransfers is off', async () => {
    await api.settings.set('detectTransfers', false)
    const from = account()
    const to = account()
    await importInto(from, [['10/01/2024', 'Off out', '-888.00']])
    const result = await importInto(to, [['10/01/2024', 'Off in', '888.00']])

    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(importedRow(from, 'Off out'))).toBeNull()
    expect(categoryOf(importedRow(to, 'Off in'))).toBeNull()
  })
})

describe('reset to defaults', () => {
  // wipes every user category, so it runs last in this file
  it('replaces user categories, keeps system ones and their rows, prunes rules', async () => {
    const custom = category('Custom before reset')
    const keptRule = rule('Into transfers', 'sweep', systemCategory('transfers'))
    const lostRule = rule('Into custom', 'custom thing', custom)
    const filed = txn(checking, { categoryId: custom, posted: noon(2026, 9, 2) })
    const transfer = txn(checking, { categoryId: systemCategory('transfers') })

    const list = await api.categories.resetDefaults()

    expect(list.groups.map((g) => g.name)).toEqual(DEFAULT_CATEGORY_GROUPS.map((g) => g.name))
    expect(list.groups.map((g) => g.categories.length)).toEqual(
      DEFAULT_CATEGORY_GROUPS.map((g) => g.categories.length)
    )
    expect(list.ungrouped).toEqual([])
    expect(list.system.map((c) => c.systemKey).sort()).toEqual(['income', 'opening', 'transfers'])

    expect(count('categories', `id = ${custom}`)).toBe(0)
    expect(categoryOf(filed)).toBeNull()
    expect(categoryOf(transfer)).toBe(systemCategory('transfers'))
    expect(count('rules', `id = ${lostRule}`)).toBe(0)
    expect(count('rules', `id = ${keptRule}`)).toBe(1)
  })
})
