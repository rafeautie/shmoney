import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TRANSACTION_FILTERS } from '@shared/transaction-filters'
import { api } from './harness/api'
import { account, category, rule, txn } from './harness/builders'
import { count, query, snapshot } from './harness/db'

let checking: number

const categoryOf = (id: number): number | null =>
  query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c
const amountOf = (id: number): number =>
  query<{ a: number }>(`SELECT amount AS a FROM transactions WHERE id = ${id}`)[0].a
const descriptionOf = (id: number): string =>
  query<{ d: string }>(`SELECT description AS d FROM transactions WHERE id = ${id}`)[0].d
const deletedAtOf = (id: number): number | null =>
  query<{ d: number | null }>(`SELECT deleted_at AS d FROM transactions WHERE id = ${id}`)[0].d
const newestEntry = (): number =>
  query<{ id: number | null }>('SELECT max(id) AS id FROM action_log')[0].id ?? 0
const undoneAt = (entryId: number): number | null =>
  query<{ u: number | null }>(`SELECT undone_at AS u FROM action_log WHERE id = ${entryId}`)[0].u

const recategorize = (transactionId: number, categoryId: number | null): Promise<number> =>
  api.transactions.setCategories({ changes: [{ transactionId, categoryId }] })

// each test starts from an empty log, so "newest" and "nothing to undo" mean what they say
function clearLog(): void {
  query('DELETE FROM action_log_transactions')
  query('DELETE FROM action_log')
  query('DELETE FROM action_runs')
}

beforeAll(() => {
  checking = account({ name: 'Checking' })
})

// runs first: nothing has been logged yet in this file's database
describe('an empty log', () => {
  it('has nothing for keyboard undo or redo to take', async () => {
    expect(count('action_log')).toBe(0)
    expect(await api.actionLog.undo()).toBeNull()
    expect(await api.actionLog.redo()).toBeNull()
  })
})

describe('compare-and-set', () => {
  beforeEach(clearLog)

  it('undo of a category change skips a row recategorized since', async () => {
    const [a, b, c] = [category(), category(), category()]
    const t = txn(checking, { categoryId: a })
    await recategorize(t, b)
    const first = newestEntry()
    await recategorize(t, c)

    const result = await api.actionLog.undoEntry(first)

    expect(result.applied).toBe(0)
    expect(categoryOf(t)).toBe(c)
  })

  it('undo of an amount edit skips a row edited again', async () => {
    const t = txn(checking, { amount: -1000 })
    await api.transactions.update({ id: t, amount: -2000 })
    const first = newestEntry()
    await api.transactions.update({ id: t, amount: -3000 })

    const result = await api.actionLog.undoEntry(first)

    expect(result.applied).toBe(0)
    expect(amountOf(t)).toBe(-3000)
  })

  it('undo of a description edit skips a row edited again', async () => {
    const t = txn(checking, { description: 'original' })
    await api.transactions.update({ id: t, description: 'second' })
    const first = newestEntry()
    await api.transactions.update({ id: t, description: 'third' })

    const result = await api.actionLog.undoEntry(first)

    expect(result.applied).toBe(0)
    expect(descriptionOf(t)).toBe('third')
  })

  it('undo of a delete skips a row deleted again at another moment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 8, 1, 12))
      const t = txn(checking)
      await api.transactions.bulkDelete({ transactionIds: [t] })
      const firstDelete = newestEntry()
      await api.actionLog.undoEntry(firstDelete)
      vi.setSystemTime(new Date(2026, 8, 2, 12))
      await api.transactions.bulkDelete({ transactionIds: [t] })
      const secondStamp = deletedAtOf(t)

      const result = await api.actionLog.undoEntry(firstDelete)

      expect(result.applied).toBe(0)
      expect(deletedAtOf(t)).toBe(secondStamp)
    } finally {
      vi.useRealTimers()
    }
  })

  it('redo of a delete skips a row whose deletedAt moved since the undo', async () => {
    const t = txn(checking)
    await api.transactions.bulkDelete({ transactionIds: [t] })
    const del = newestEntry()
    await api.actionLog.undoEntry(del)
    query(`UPDATE transactions SET deleted_at = 1 WHERE id = ${t}`)

    const result = await api.actionLog.redoEntry(del)

    expect(result.applied).toBe(0)
    expect(deletedAtOf(t)).toBe(1)
  })

  it('undo of an added envelope skips a fill edited since', async () => {
    const groceries = category()
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 100_000 })
    const added = newestEntry()
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 200_000 })

    const result = await api.actionLog.undoEntry(added)

    expect(result.applied).toBe(0)
    expect(query(`SELECT amount FROM budgets WHERE category_id = ${groceries}`)).toEqual([
      { amount: 200_000 }
    ])
  })

  it('undo of a saved filter delete skips when a live preset took the name', async () => {
    const original = await api.savedFilters.create({
      name: 'Big spends',
      filters: DEFAULT_TRANSACTION_FILTERS
    })
    const actionId = await api.savedFilters.delete(original.id)
    const replacement = await api.savedFilters.create({
      name: 'Big spends',
      filters: DEFAULT_TRANSACTION_FILTERS
    })

    const result = await api.actionLog.undoEntry(actionId!)

    expect(result.applied).toBe(0)
    expect(query('SELECT id FROM saved_filters WHERE deleted_at IS NULL')).toEqual([
      { id: replacement.id }
    ])
  })
})

describe('undoEntry and redoEntry', () => {
  beforeEach(clearLog)

  it('reject an id that is not in the log', async () => {
    await expect(api.actionLog.undoEntry(999_999)).rejects.toThrow('Action not found')
    await expect(api.actionLog.redoEntry(999_999)).rejects.toThrow('Action not found')
  })

  it('undoing an undone entry again changes nothing', async () => {
    const [a, b] = [category(), category()]
    const t = txn(checking, { categoryId: a })
    await recategorize(t, b)
    const entry = newestEntry()

    expect((await api.actionLog.undoEntry(entry)).applied).toBe(1)
    const settled = snapshot()
    expect((await api.actionLog.undoEntry(entry)).applied).toBe(0)

    expect(snapshot()).toEqual(settled)
    expect(categoryOf(t)).toBe(a)
  })

  it('redoing an applied entry again changes nothing', async () => {
    const [a, b] = [category(), category()]
    const t = txn(checking, { categoryId: a })
    await recategorize(t, b)
    const entry = newestEntry()
    const settled = snapshot()

    expect((await api.actionLog.redoEntry(entry)).applied).toBe(0)

    expect(snapshot()).toEqual(settled)
    expect(categoryOf(t)).toBe(b)
  })

  it('stamp and clear undone_at', async () => {
    const t = txn(checking)
    await recategorize(t, category())
    const entry = newestEntry()
    expect(undoneAt(entry)).toBeNull()

    await api.actionLog.undoEntry(entry)
    expect(undoneAt(entry)).not.toBeNull()

    await api.actionLog.redoEntry(entry)
    expect(undoneAt(entry)).toBeNull()
  })
})

describe('runs', () => {
  const runIds = (): number[] =>
    query<{ id: number }>('SELECT id FROM action_runs ORDER BY id').map((r) => r.id)

  let alpha: number
  let beta: number
  let tAlpha: number
  let tBeta: number

  beforeEach(() => {
    clearLog()
    alpha = category()
    beta = category()
    rule('Alpha rule', 'runalpha', alpha)
    rule('Beta rule', 'runbeta', beta)
    tAlpha = txn(checking, { description: 'runalpha one' })
    tBeta = txn(checking, { description: 'runbeta one' })
  })

  afterEach(() => {
    // later specs in this file should not see these rules fire
    query("DELETE FROM rules WHERE name IN ('Alpha rule', 'Beta rule')")
  })

  it('applying rules writes one apply-rules run holding an entry per firing rule', async () => {
    const result = await api.rules.apply()

    expect(result).toEqual({ categorized: 2, rulesFired: 2 })
    const [run] = query<{ id: number; trigger: string; label: string }>('SELECT * FROM action_runs')
    expect(run).toMatchObject({ trigger: 'apply-rules', label: 'Apply rules' })
    expect(
      query<{ source: string }>(`SELECT source FROM action_log WHERE run_id = ${run.id}`)
    ).toEqual([{ source: 'rule' }, { source: 'rule' }])
  })

  it('undoRun undoes every entry and redoRun restores them', async () => {
    await api.rules.apply()
    const [runId] = runIds()
    const applied = snapshot()

    expect(await api.actionLog.undoRun(runId)).toEqual({ runId, entries: 2, applied: 2 })
    expect(categoryOf(tAlpha)).toBeNull()
    expect(categoryOf(tBeta)).toBeNull()
    expect(count('action_log', `run_id = ${runId} AND undone_at IS NOT NULL`)).toBe(2)

    expect(await api.actionLog.redoRun(runId)).toEqual({ runId, entries: 2, applied: 2 })
    expect(categoryOf(tAlpha)).toBe(alpha)
    expect(categoryOf(tBeta)).toBe(beta)
    expect(snapshot()).toEqual(applied)
  })

  it('undoRun with nothing applied, and redoRun with nothing undone, flip no entries', async () => {
    await api.rules.apply()
    const [runId] = runIds()

    expect(await api.actionLog.redoRun(runId)).toEqual({ runId, entries: 0, applied: 0 })
    await api.actionLog.undoRun(runId)
    expect(await api.actionLog.undoRun(runId)).toEqual({ runId, entries: 0, applied: 0 })
  })

  it('a run on a missing id flips nothing', async () => {
    expect(await api.actionLog.undoRun(424_242)).toEqual({ runId: 424_242, entries: 0, applied: 0 })
  })

  it('a trigger that changes nothing leaves no run row', async () => {
    await api.rules.apply()
    expect(runIds()).toHaveLength(1)

    // everything is categorized now; a second apply has nothing to do
    expect(await api.rules.apply()).toEqual({ categorized: 0, rulesFired: 0 })

    expect(runIds()).toHaveLength(1)
    expect(count('action_log')).toBe(2)
  })

  it('undoRun counts a superseded entry as flipped but applies nothing for it', async () => {
    await api.rules.apply()
    const [runId] = runIds()
    await recategorize(tAlpha, beta)

    const result = await api.actionLog.undoRun(runId)

    expect(result).toEqual({ runId, entries: 2, applied: 1 })
    expect(categoryOf(tAlpha)).toBe(beta)
    expect(categoryOf(tBeta)).toBeNull()
  })
})

describe('keyboard undo and redo', () => {
  beforeEach(() => {
    clearLog()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
  })
  afterEach(() => vi.useRealTimers())

  const tick = (): void => {
    vi.setSystemTime(Date.now() + 1000)
  }

  // one user entry per transaction: an amount edit, which is trivially distinguishable
  async function userEdits(n: number): Promise<{ ids: number[]; entries: number[] }> {
    const ids: number[] = []
    const entries: number[] = []
    for (let i = 0; i < n; i++) {
      const t = txn(checking, { amount: -1000 })
      await api.transactions.update({ id: t, amount: -2000 })
      ids.push(t)
      entries.push(newestEntry())
      tick()
    }
    return { ids, entries }
  }

  it('skips an automated entry that is newer than the user entry', async () => {
    const target = category()
    rule('Keyboard rule', 'kbdphrase', target)
    const { ids, entries } = await userEdits(1)
    const automated = txn(checking, { description: 'kbdphrase here' })
    await api.rules.apply()
    query("DELETE FROM rules WHERE name = 'Keyboard rule'")
    expect(newestEntry()).toBeGreaterThan(entries[0])

    const result = await api.actionLog.undo()

    expect(result?.id).toBe(entries[0])
    expect(amountOf(ids[0])).toBe(-1000)
    expect(categoryOf(automated)).toBe(target)
    expect(await api.actionLog.undo()).toBeNull()
  })

  it('undo takes the newest applied user entry, one at a time', async () => {
    const { ids, entries } = await userEdits(3)

    expect((await api.actionLog.undo())?.id).toBe(entries[2])
    expect((await api.actionLog.undo())?.id).toBe(entries[1])
    expect(amountOf(ids[2])).toBe(-1000)
    expect(amountOf(ids[1])).toBe(-1000)
    expect(amountOf(ids[0])).toBe(-2000)
  })

  it('redo takes the most recently undone entry', async () => {
    const { entries } = await userEdits(3)
    await api.actionLog.undo()
    tick()
    await api.actionLog.undo()
    tick()

    expect((await api.actionLog.redo())?.id).toBe(entries[1])
    expect((await api.actionLog.redo())?.id).toBe(entries[2])
    expect(await api.actionLog.redo()).toBeNull()
  })

  it('new work does not clear the redo stack', async () => {
    const { ids, entries } = await userEdits(1)
    await api.actionLog.undo()
    tick()
    await userEdits(1)

    const redone = await api.actionLog.redo()

    expect(redone).toMatchObject({ id: entries[0], applied: 1 })
    expect(amountOf(ids[0])).toBe(-2000)
  })

  it('an Activity undo of a user entry becomes the redo target', async () => {
    const { ids, entries } = await userEdits(2)
    await api.actionLog.undo()
    tick()
    await api.actionLog.undoEntry(entries[0])
    tick()

    expect((await api.actionLog.redo())?.id).toBe(entries[0])
    expect(amountOf(ids[0])).toBe(-2000)
  })

  it('never redoes an automated entry undone from Activity', async () => {
    const target = category()
    rule('Keyboard rule', 'kbdphrase2', target)
    const t = txn(checking, { description: 'kbdphrase2 here' })
    await api.rules.apply()
    query("DELETE FROM rules WHERE name = 'Keyboard rule'")
    await api.actionLog.undoEntry(newestEntry())
    expect(categoryOf(t)).toBeNull()

    expect(await api.actionLog.redo()).toBeNull()
    expect(categoryOf(t)).toBeNull()
  })

  it('returns null once everything is undone or redone', async () => {
    await userEdits(2)

    await api.actionLog.undo()
    await api.actionLog.undo()
    expect(await api.actionLog.undo()).toBeNull()

    await api.actionLog.redo()
    await api.actionLog.redo()
    expect(await api.actionLog.redo()).toBeNull()
  })
})

describe('paging', () => {
  beforeEach(clearLog)

  // alternating categories makes every call a real change, so every call an entry
  async function userEntries(n: number): Promise<void> {
    const [a, b] = [category(), category()]
    const t = txn(checking, { categoryId: a })
    for (let i = 0; i < n; i++) await recategorize(t, i % 2 === 0 ? b : a)
  }

  const ids = (entries: { id: number }[]): number[] => entries.map((e) => e.id)

  it('returns 100 entries newest first with a cursor to the rest', async () => {
    await userEntries(130)
    const all = query<{ id: number }>('SELECT id FROM action_log ORDER BY id DESC').map((r) => r.id)

    const first = await api.actionLog.page()
    expect(ids(first.entries)).toEqual(all.slice(0, 100))
    expect(first.nextBefore).toBe(all[99])

    const second = await api.actionLog.page({ before: first.nextBefore! })
    expect(ids(second.entries)).toEqual(all.slice(100))
    expect(second.nextBefore).toBeNull()
  })

  it('has no cursor when the history fits one page', async () => {
    await userEntries(100)
    const page = await api.actionLog.page()
    expect(page.entries).toHaveLength(100)
    expect(page.nextBefore).toBeNull()
  })

  it('finishes a run that straddles the page boundary instead of splitting it', async () => {
    await userEntries(3)
    const runCats = Array.from({ length: 10 }, () => category())
    runCats.forEach((c, i) => {
      rule(`Paging rule ${i}`, `pgrun${i}x`, c)
      txn(checking, { description: `pgrun${i}x` })
    })
    await api.rules.apply()
    const [runId] = query<{ id: number }>('SELECT id FROM action_runs').map((r) => r.id)
    const runEntries = query<{ id: number }>(
      `SELECT id FROM action_log WHERE run_id = ${runId} ORDER BY id DESC`
    ).map((r) => r.id)
    expect(runEntries).toHaveLength(10)
    // 95 newer entries put only the run's newest five inside the first 100
    await userEntries(95)
    query("DELETE FROM rules WHERE name LIKE 'Paging rule %'")

    const first = await api.actionLog.page()

    expect(first.entries).toHaveLength(105)
    expect(runEntries.every((id) => ids(first.entries).includes(id))).toBe(true)
    expect(first.runs[runId]).toMatchObject({ trigger: 'apply-rules' })
    // the cursor continues below the run, at the three older entries
    expect(first.nextBefore).toBe(runEntries.at(-1))
    const second = await api.actionLog.page({ before: first.nextBefore! })
    expect(second.entries).toHaveLength(3)
    expect(second.nextBefore).toBeNull()
    const seen = [...ids(first.entries), ...ids(second.entries)]
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(count('action_log'))
  })

  it('a run ending exactly on the boundary leaves no empty next page', async () => {
    await userEntries(90)
    const runCats = Array.from({ length: 10 }, () => category())
    runCats.forEach((c, i) => {
      rule(`Paging rule ${i}`, `pgend${i}x`, c)
      txn(checking, { description: `pgend${i}x` })
    })
    await api.rules.apply()
    query("DELETE FROM rules WHERE name LIKE 'Paging rule %'")

    const page = await api.actionLog.page()

    expect(page.entries).toHaveLength(100)
    expect(page.nextBefore).toBeNull()
  })

  it('filters by source, and a filtered page may split nothing it was not asked for', async () => {
    const target = category()
    rule('Paging rule', 'pgsrcx', target)
    txn(checking, { description: 'pgsrcx' })
    await userEntries(3)
    await api.rules.apply()
    query("DELETE FROM rules WHERE name = 'Paging rule'")

    const rules = await api.actionLog.page({ source: 'rule' })
    const users = await api.actionLog.page({ source: 'user' })

    expect(rules.entries.map((e) => e.source)).toEqual(['rule'])
    expect(users.entries.map((e) => e.source)).toEqual(['user', 'user', 'user'])
    expect(await api.actionLog.page({ source: 'llm' })).toMatchObject({
      entries: [],
      nextBefore: null
    })
  })

  it('rejects a search longer than 200 characters', async () => {
    await expect(api.actionLog.page({ q: 'x'.repeat(201) })).rejects.toThrow()
    await expect(api.actionLog.page({ q: 'x'.repeat(200) })).resolves.toMatchObject({ entries: [] })
  })

  it('rejects an unknown source', async () => {
    await expect(api.actionLog.page({ source: 'robot' as unknown as 'user' })).rejects.toThrow()
  })
})

describe('newestAutomatedAt', () => {
  beforeEach(clearLog)

  const insert = (source: string, createdAt: number): void => {
    query(
      `INSERT INTO action_log (created_at, source, label, changes) VALUES (${createdAt}, '${source}', 'seeded ${source}', '[]')`
    )
  }

  it('is null when only user and import entries exist', async () => {
    await recategorize(txn(checking), category())
    insert('import', Date.now() + 1000)

    expect(await api.actionLog.newestAutomatedAt()).toBeNull()
  })

  it('reports the newest rule, detector or llm entry, ignoring newer user and import ones', async () => {
    insert('rule', 1000)
    insert('detector', 3000)
    insert('llm', 2000)
    insert('import', 9000)
    insert('user', 9500)

    expect(await api.actionLog.newestAutomatedAt()).toBe(2000)
  })
})

// A seeded random walk over every undoable user operation. Unwinding the whole
// session with keyboard undo must land on the starting state, and replaying it
// with redo on the ending state.

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Operation = (pick: <T>(items: T[]) => T, random: () => number) => Promise<unknown>

describe('a random session', () => {
  const liveTransactions = (): number[] =>
    query<{ id: number }>(
      'SELECT id FROM transactions WHERE deleted_at IS NULL AND pending = 0 ORDER BY id'
    ).map((r) => r.id)
  const userCategories = (): number[] =>
    query<{ id: number }>('SELECT id FROM categories WHERE system_key IS NULL ORDER BY id').map(
      (r) => r.id
    )
  const liveRules = (): number[] =>
    query<{ id: number }>('SELECT id FROM rules ORDER BY id').map((r) => r.id)
  const liveFilters = (): number[] =>
    query<{ id: number }>('SELECT id FROM saved_filters WHERE deleted_at IS NULL ORDER BY id').map(
      (r) => r.id
    )

  let named = 0
  let acct: number

  const operations: Record<string, Operation> = {
    setCategory: async (pick) => {
      const live = liveTransactions()
      if (!live.length) return
      await recategorize(pick(live), pick([null, ...userCategories()]))
    },
    amount: async (pick, random) => {
      const live = liveTransactions()
      if (!live.length) return
      await api.transactions.update({ id: pick(live), amount: -Math.ceil(random() * 90_000) })
    },
    description: async (pick) => {
      const live = liveTransactions()
      if (!live.length) return
      await api.transactions.update({ id: pick(live), description: `edited ${++named}` })
    },
    create: async (pick, random) => {
      await api.transactions.create({
        accountId: acct,
        amount: -Math.ceil(random() * 50_000),
        description: `created ${++named}`,
        date: '2026-09-15',
        categoryId: pick([null, ...userCategories()])
      })
    },
    bulkDelete: async (pick) => {
      const live = liveTransactions()
      if (live.length > 2) await api.transactions.bulkDelete({ transactionIds: [pick(live)] })
    },
    setFill: async (pick, random) => {
      const cats = userCategories()
      if (!cats.length) return
      await api.budgets.setFill({
        categoryId: pick(cats),
        month: pick(['2026-08', '2026-09', '2026-10']),
        amount: Math.floor(random() * 5) * 10_000
      })
    },
    deleteFilter: async (pick) => {
      const live = liveFilters()
      if (live.length) await api.savedFilters.delete(pick(live))
    },
    deleteCategory: async (pick) => {
      const cats = userCategories()
      if (cats.length > 3) await api.categories.delete(pick(cats))
    },
    deleteRule: async (pick) => {
      const live = liveRules()
      if (live.length) await api.rules.delete(pick(live))
    }
  }

  async function seedAndRun(names: string[], steps: number, seed: number): Promise<void> {
    const random = prng(seed)
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
    for (let i = 0; i < steps; i++) await operations[pick(names)](pick, random)
  }

  // undoing a create soft-deletes the row rather than removing it, so rows the
  // walk made count only while live
  function liveSnapshot(firstNewId: number): Record<string, string[]> {
    const state = snapshot()
    state.transactions = state.transactions.filter((row) => {
      const columns = Object.fromEntries(JSON.parse(row) as [string, unknown][])
      return (columns.id as number) < firstNewId || columns.deleted_at === null
    })
    return state
  }

  async function drain(step: () => Promise<unknown>): Promise<number> {
    let n = 0
    while ((await step()) !== null) {
      if (++n > 1000) throw new Error('undo/redo never ran out of entries')
      // redo orders by undone_at in milliseconds, so each step gets its own
      vi.setSystemTime(Date.now() + 10)
    }
    return n
  }

  beforeEach(() => {
    clearLog()
    vi.useFakeTimers({ toFake: ['Date'] })
    named = 0
    acct = account({ name: 'Walk' })
    const cats = Array.from({ length: 4 }, () => category())
    cats.slice(0, 2).forEach((c, i) => rule(`Walk rule ${i}`, `walkrule${i}`, c))
    for (let i = 0; i < 6; i++) txn(acct, { categoryId: i % 2 ? cats[i % 4] : null })
  })

  afterEach(() => vi.useRealTimers())

  // creating a saved filter is not logged (only the delete is undoable), so the
  // walk starts with presets to delete rather than creating its own
  beforeAll(async () => {
    for (let i = 0; i < 4; i++) {
      await api.savedFilters.create({
        name: `Walk preset ${i}`,
        filters: DEFAULT_TRANSACTION_FILTERS
      })
    }
  })

  const walks: { name: string; operations: string[] }[] = [
    {
      name: 'transaction edits, budgets and saved filters',
      operations: [
        'setCategory',
        'amount',
        'description',
        'create',
        'bulkDelete',
        'setFill',
        'deleteFilter'
      ]
    },
    {
      name: 'every operation, including category and rule deletes',
      operations: Object.keys(operations)
    }
  ]

  for (const { name, operations: names } of walks) {
    it(`unwinds and replays ${name}`, async () => {
      const firstNewId = query<{ n: number }>('SELECT max(id) + 1 AS n FROM transactions')[0].n
      const start = liveSnapshot(firstNewId)
      await seedAndRun(names, 40, 20260915)
      const end = liveSnapshot(firstNewId)
      expect(end, 'the walk changed nothing').not.toEqual(start)
      const entries = count('action_log')
      expect(entries).toBeGreaterThan(15)

      expect(await drain(() => api.actionLog.undo())).toBe(entries)
      expect(liveSnapshot(firstNewId)).toEqual(start)

      expect(await drain(() => api.actionLog.redo())).toBe(entries)
      expect(liveSnapshot(firstNewId)).toEqual(end)
    })
  }
})

// Suspected engine bugs, each reproduced by hand against this harness. They are
// written up rather than asserted, so the suite stays green until someone
// decides what the behavior should be.
describe('triage', () => {
  it.todo(
    'TRIAGE: an undo that applied 0 rows still stamps undone_at. Repro: recategorize a row A to B (entry 1), then B to C; undoEntry(1) resolves { applied: 0 }, leaves the row on C, but entry 1 now has undone_at set, so Activity shows it as "Undone" although nothing was undone, and redo() will pick it up. applyEntry writes undoneAt unconditionally (action-log.ts, the tx.update(actionLog).set({ undoneAt ... }) after the change loop)'
  )
  it.todo(
    'TRIAGE: undoing a categoryId change onto a since-deleted category throws a raw FK error. Repro: recategorize a row A to B (entry 1), delete category A, undoEntry(1) rejects with "FOREIGN KEY constraint failed"; the transaction rolls back so undone_at stays null and the entry cannot be undone until the category delete is undone first. setGuarded (action-log.ts) writes categoryId with no existence check, unlike setBudgetGuarded which skips when the category is gone and restoreRuleSnapshot which checks its target. Inside undoRun it fails the whole run'
  )
  it.todo(
    'TRIAGE: redo of a rule or category delete is not compare-and-set. Repro: delete a rule (entry 1), undoEntry(1), edit the rule via rules.update, redoEntry(1) resolves { applied: 1 } and deletes the edited rule. Same for categories: after undo, rename the category and set a budget fill on it, redo deletes both (applyEntry redo branches: tx.delete(rules).where(eq(rules.id, snapshot.id)) and deleteCategorySnapshot in deletion-snapshots.ts delete by id with no guard against changes made since the undo)'
  )
  it.todo(
    'TRIAGE: keyboard redo breaks ties on undone_at (milliseconds) by id DESC, which is the wrong end of an undo chain. Repro: two user entries E1 < E2, undo() twice inside one millisecond (E2 then E1), redo() picks E2 (applied 0, because E1 is still undone and E2 is guarded on the result of E1) instead of E1; E2 is then marked applied with its change missing. redoNewest orders by desc(undoneAt), desc(id) (action-log.ts). Needs sub-millisecond undos, so low severity, but a held Ctrl+Z autorepeat on a fast machine is close; the model test advances the clock between steps to avoid it'
  )
  it.todo(
    'TRIAGE (observation): savedFilters.create writes no action-log entry while savedFilters.delete does, so a session that creates presets cannot be unwound to its starting state with keyboard undo (the preset stays). Probably intended since create is not offered as undoable, but the asymmetry means Ctrl+Z after "save preset, delete preset" restores the deleted one and never removes the new one'
  )
})
