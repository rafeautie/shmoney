import { beforeAll, describe, expect, it } from 'vitest'
import { api } from './harness/api'
import { account, category, group, rule, txn } from './harness/builders'
import { count, query } from './harness/db'
import { expectUndoRoundTrip } from './harness/undo'

let checking: number

const categoryOf = (id: number): number | null =>
  query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c

beforeAll(() => {
  checking = account({ name: 'Checking' })
})

describe('category group delete', () => {
  it('undo restores the group, its categories, assignments, fills and rules; redo deletes again', async () => {
    const fun = group('Fun')
    const games = category('Games', fun)
    const music = category('Music', fun)
    const t1 = txn(checking, { categoryId: games })
    txn(checking, { categoryId: music })
    await api.budgets.setFill({ categoryId: games, month: '2026-09', amount: 5000 })
    const gamesRule = rule('Games rule', 'row', games)

    const actionId = await expectUndoRoundTrip(() => api.categories.deleteGroup(fun))

    // after the round trip's redo, the group and everything hanging off it is gone again
    expect(count('category_groups', `id = ${fun}`)).toBe(0)
    expect(categoryOf(t1)).toBeNull()
    expect(count('rules', `id = ${gamesRule}`)).toBe(0)

    await api.actionLog.undoEntry(actionId)
    expect(count('categories', `id IN (${games}, ${music})`)).toBe(2)
    expect(categoryOf(t1)).toBe(games)
    expect(query(`SELECT amount FROM budgets WHERE category_id = ${games}`)).toEqual([
      { amount: 5000 }
    ])
    expect(query(`SELECT name FROM rules WHERE id = ${gamesRule}`)).toEqual([
      { name: 'Games rule' }
    ])
  })

  it('undo leaves a transaction the user recategorized since', async () => {
    const pets = category('Pets')
    const vet = category('Vet')
    const t = txn(checking, { categoryId: pets })

    const actionId = await api.categories.delete(pets)
    await api.transactions.setCategories({ changes: [{ transactionId: t, categoryId: vet }] })
    await api.actionLog.undoEntry(actionId!)

    expect(query(`SELECT name FROM categories WHERE id = ${pets}`)).toEqual([{ name: 'Pets' }])
    expect(categoryOf(t)).toBe(vet)
  })
})

describe('rule delete', () => {
  it('undo reinserts the rule with its id', async () => {
    const coffee = category('Coffee')
    const coffeeRule = rule('Coffee rule', 'coffee', coffee)

    await expectUndoRoundTrip(() => api.rules.delete(coffeeRule))
    expect(count('rules', `id = ${coffeeRule}`)).toBe(0)
  })
})
