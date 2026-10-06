import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RuleSuggestion, RuleSuggestionsCreatedEvent } from '@shared/rule-suggestions'
import { db } from '../../demo/db'
import { rules } from '../db/schema'
import { api } from './harness/api'
import { account, category, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'
import { fakeLlm } from './harness/fakes/llm'

let checking: number
let events: RuleSuggestionsCreatedEvent[]
let unsubscribe: () => void

// detection runs on setImmediate after the commit, then awaits the model
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** n uncategorized rows sharing one description, as ids */
function rowsLike(description: string, n = 3): number[] {
  return Array.from({ length: n }, () => txn(checking, { description }))
}

async function categorize(ids: number[], categoryId: number | null): Promise<void> {
  await api.transactions.setCategories({
    changes: ids.map((transactionId) => ({ transactionId, categoryId }))
  })
  await settle()
}

const pending = async (): Promise<Awaited<ReturnType<typeof api.ruleSuggestions.list>>> =>
  api.ruleSuggestions.list()

const suggestionFor = async (description: string): Promise<RuleSuggestion | undefined> =>
  (await pending()).find((s) => s.descriptionKey === description)

const statusOf = (id: number): string =>
  query<{ status: string }>(`SELECT status FROM rule_suggestions WHERE id = ${id}`)[0].status

const suggestionRows = (description: string): number =>
  count('rule_suggestions', `description_key = '${description}'`)

beforeAll(() => {
  checking = account({ name: 'Suggestions checking' })
})

beforeEach(() => {
  db.delete(rules).run()
  events = []
  unsubscribe = api.ruleSuggestions.onCreated((event) => events.push(event))
})

afterEach(async () => {
  unsubscribe()
  await api.settings.set('ruleSuggestionsEnabled', true)
})

describe('detection', () => {
  it('three identically described rows make one pending suggestion', async () => {
    const target = category('Streaming')
    const ids = rowsLike('NETFLIX.COM 8827')

    await categorize(ids, target)

    const found = await suggestionFor('NETFLIX.COM 8827')
    expect(found).toMatchObject({
      phrase: 'NETFLIX.COM 8827',
      categoryId: target,
      categoryName: 'Streaming',
      matchCount: 3,
      source: 'user'
    })
    expect(suggestionRows('NETFLIX.COM 8827')).toBe(1)
  })

  it('pushes a created event with the count', async () => {
    await categorize(rowsLike('PUSH ME 1'), category())
    expect(events).toEqual([{ count: 1 }])
  })

  it('two identical rows are not enough', async () => {
    await categorize(rowsLike('ONLY TWO', 2), category())
    expect(suggestionRows('ONLY TWO')).toBe(0)
    expect(events).toEqual([])
  })

  it('counts rows that were categorized before, not just the new ones', async () => {
    const target = category()
    const earlier = rowsLike('SPLIT BATCH', 2)
    await categorize(earlier, target)
    expect(suggestionRows('SPLIT BATCH')).toBe(0)

    await categorize(rowsLike('SPLIT BATCH', 1), target)
    expect(suggestionRows('SPLIT BATCH')).toBe(1)
  })

  it('a second pass over a pending pair adds neither a row nor an event', async () => {
    const target = category()
    const ids = rowsLike('ONLY ONCE')
    await categorize(ids, target)
    events = []

    await categorize(ids, null)
    await categorize(ids, target)

    expect(suggestionRows('ONLY ONCE')).toBe(1)
    expect(events).toEqual([])
  })

  it('clusters filed under Transfers never suggest', async () => {
    await categorize(rowsLike('MOVE MONEY'), systemCategory('transfers'))
    expect(suggestionRows('MOVE MONEY')).toBe(0)
  })

  it('records a different category as its own suggestion', async () => {
    const one = category()
    const two = category()
    const ids = rowsLike('TWO HOMES')
    await categorize(ids, one)
    await categorize(ids, two)
    expect(suggestionRows('TWO HOMES')).toBe(2)
  })
})

describe('phrase extraction', () => {
  it('uses the model phrase when one is ready', async () => {
    fakeLlm.ready()
    let seen: { feature: string; prompt: string } | null = null
    fakeLlm.onGenerate((feature, prompt) => {
      seen = { feature, prompt }
      return { reason: 'the merchant', phrase: 'CHIPOTLE' }
    })

    await categorize(rowsLike('TST* CHIPOTLE 0421 DENVER CO'), category())

    expect(seen).toMatchObject({ feature: 'ruleTerm' })
    expect(seen!.prompt).toContain('TST* CHIPOTLE 0421 DENVER CO')
    const found = await suggestionFor('TST* CHIPOTLE 0421 DENVER CO')
    expect(found?.phrase).toBe('CHIPOTLE')
  })

  it('falls back to the full description with no model on disk', async () => {
    let calls = 0
    fakeLlm.onGenerate(() => {
      calls++
      return { reason: 'x', phrase: 'IGNORED' }
    })

    await categorize(rowsLike('NO MODEL HERE 77'), category())

    expect(calls).toBe(0)
    expect((await suggestionFor('NO MODEL HERE 77'))?.phrase).toBe('NO MODEL HERE 77')
  })

  it('falls back to the full description when generation throws', async () => {
    fakeLlm.ready()
    fakeLlm.onGenerate(() => {
      throw new Error('out of memory')
    })
    await categorize(rowsLike('GENERATION BROKE'), category())
    expect((await suggestionFor('GENERATION BROKE'))?.phrase).toBe('GENERATION BROKE')
  })

  it('falls back to the full description when the phrase comes back blank', async () => {
    fakeLlm.ready()
    fakeLlm.onGenerate(() => ({ reason: 'none', phrase: '   ' }))
    await categorize(rowsLike('BLANK PHRASE'), category())
    expect((await suggestionFor('BLANK PHRASE'))?.phrase).toBe('BLANK PHRASE')
  })

  it('folds two clusters that extract the same term into one suggestion', async () => {
    fakeLlm.ready()
    fakeLlm.onGenerate(() => ({ reason: 'brand', phrase: 'ACME' }))
    const target = category()

    await categorize([...rowsLike('ACME STORE 1'), ...rowsLike('ACME STORE 2')], target)

    const acme = (await pending()).filter((s) => s.phrase === 'ACME')
    expect(acme).toHaveLength(1)
    expect(acme[0].matchCount).toBe(6)
  })
})

describe('suppression', () => {
  it('an enabled rule with the same target covers the cluster', async () => {
    const target = category()
    await api.rules.create({
      name: 'Covers it',
      conditions: { description: { op: 'contains', phrases: ['covered'] } },
      action: { type: 'setCategory', categoryId: target }
    })
    await categorize(rowsLike('COVERED BY RULE'), target)
    expect(suggestionRows('COVERED BY RULE')).toBe(0)
  })

  it('a rule aimed at another category does not cover it', async () => {
    const other = category()
    await api.rules.create({
      name: 'Elsewhere',
      conditions: { description: { op: 'contains', phrases: ['elsewhere'] } },
      action: { type: 'setCategory', categoryId: other }
    })
    await categorize(rowsLike('ELSEWHERE RULE'), category())
    expect(suggestionRows('ELSEWHERE RULE')).toBe(1)
  })

  it('a disabled rule does not cover it', async () => {
    const target = category()
    const created = await api.rules.create({
      name: 'Switched off',
      conditions: { description: { op: 'contains', phrases: ['switched off'] } },
      action: { type: 'setCategory', categoryId: target }
    })
    await api.rules.update({ id: created.id, enabled: false })
    await categorize(rowsLike('SWITCHED OFF RULE'), target)
    expect(suggestionRows('SWITCHED OFF RULE')).toBe(1)
  })

  it('turning ruleSuggestionsEnabled off stops detection', async () => {
    await api.settings.set('ruleSuggestionsEnabled', false)
    await categorize(rowsLike('SUGGESTIONS OFF'), category())
    expect(suggestionRows('SUGGESTIONS OFF')).toBe(0)
    expect(events).toEqual([])
  })

  it.todo(
    'TRIAGE: turning ruleSuggestionsEnabled off leaves already-pending suggestions in the list (src/main/ipc/rule-suggestions.ts:195-225, listSuggestions never checks suggestionsEnabled)'
  )
})

describe('dismiss and accept', () => {
  it('dismiss hides the suggestion without deleting it', async () => {
    await categorize(rowsLike('DISMISS ME'), category())
    const found = (await suggestionFor('DISMISS ME'))!

    expect(await api.ruleSuggestions.dismiss(found.id)).toBe(true)

    expect(await suggestionFor('DISMISS ME')).toBeUndefined()
    expect(statusOf(found.id)).toBe('dismissed')
  })

  it('categorizing the cluster again reactivates a dismissed suggestion without a new generation', async () => {
    fakeLlm.ready()
    let calls = 0
    fakeLlm.onGenerate(() => {
      calls++
      return { reason: 'brand', phrase: 'REVIVE' }
    })
    const target = category()
    const ids = rowsLike('REVIVE ME 5')
    await categorize(ids, target)
    const first = (await suggestionFor('REVIVE ME 5'))!
    await api.ruleSuggestions.dismiss(first.id)
    events = []

    await categorize(ids, null)
    expect(await suggestionFor('REVIVE ME 5')).toBeUndefined()
    await categorize(ids, target)

    const again = (await suggestionFor('REVIVE ME 5'))!
    expect(again.id).toBe(first.id)
    expect(statusOf(first.id)).toBe('pending')
    expect(calls).toBe(1)
    expect(events).toEqual([{ count: 1 }])
  })

  it('accept hides the suggestion', async () => {
    await categorize(rowsLike('ACCEPT ME'), category())
    const found = (await suggestionFor('ACCEPT ME'))!
    expect(await api.ruleSuggestions.accept(found.id)).toBe(true)
    expect(await suggestionFor('ACCEPT ME')).toBeUndefined()
    expect(statusOf(found.id)).toBe('accepted')
  })

  it('deleting the covering rule reopens an accepted suggestion', async () => {
    const target = category()
    await categorize(rowsLike('REOPEN ON DELETE'), target)
    const found = (await suggestionFor('REOPEN ON DELETE'))!
    await api.ruleSuggestions.accept(found.id)
    const covering = await api.rules.create({
      name: 'Accepted rule',
      conditions: { description: { op: 'contains', phrases: ['REOPEN ON DELETE'] } },
      action: { type: 'setCategory', categoryId: target }
    })
    // still covered while the rule stands
    await api.rules.update({ id: covering.id, name: 'Accepted rule, renamed' })
    expect(statusOf(found.id)).toBe('accepted')
    events = []

    await api.rules.delete(covering.id)

    expect(statusOf(found.id)).toBe('pending')
    expect((await suggestionFor('REOPEN ON DELETE'))?.id).toBe(found.id)
    expect(events).toEqual([{ count: 1 }])
  })

  it('disabling the covering rule reopens an accepted suggestion', async () => {
    const target = category()
    await categorize(rowsLike('REOPEN ON DISABLE'), target)
    const found = (await suggestionFor('REOPEN ON DISABLE'))!
    await api.ruleSuggestions.accept(found.id)
    const covering = await api.rules.create({
      name: 'Soon disabled',
      conditions: { description: { op: 'contains', phrases: ['REOPEN ON DISABLE'] } },
      action: { type: 'setCategory', categoryId: target }
    })

    await api.rules.update({ id: covering.id, enabled: false })
    expect(statusOf(found.id)).toBe('pending')
  })

  it('deleting a rule leaves a dismissed suggestion dismissed', async () => {
    const target = category()
    await categorize(rowsLike('STAY DISMISSED'), target)
    const found = (await suggestionFor('STAY DISMISSED'))!
    await api.ruleSuggestions.dismiss(found.id)
    const unrelated = await api.rules.create({
      name: 'Unrelated',
      conditions: { description: { op: 'contains', phrases: ['unrelated'] } },
      action: { type: 'setCategory', categoryId: target }
    })

    await api.rules.delete(unrelated.id)
    expect(statusOf(found.id)).toBe('dismissed')
  })

  it.todo(
    'TRIAGE: ruleSuggestions.dismiss and accept resolve true for an id that does not exist (src/main/ipc/rule-suggestions.ts:251-257, setStatus ignores the update count)'
  )
})

describe('list', () => {
  it('hides a suggestion whose live count drops under three, and shows it again when it recovers', async () => {
    const ids = rowsLike('SHRINKING CLUSTER')
    await categorize(ids, category())
    expect((await suggestionFor('SHRINKING CLUSTER'))?.matchCount).toBe(3)

    const [deleted] = await api.transactions.bulkDelete({ transactionIds: [ids[0]] })
    expect(deleted).toBe(ids[0])
    expect(await suggestionFor('SHRINKING CLUSTER')).toBeUndefined()
    expect(suggestionRows('SHRINKING CLUSTER')).toBe(1)

    // a fourth row brings the live count back to three
    txn(checking, { description: 'SHRINKING CLUSTER' })
    expect((await suggestionFor('SHRINKING CLUSTER'))?.matchCount).toBe(3)
  })

  it('counts through the phrase, so a short extracted term reaches more rows', async () => {
    fakeLlm.ready()
    fakeLlm.onGenerate(() => ({ reason: 'brand', phrase: 'WIDEBRAND' }))
    await categorize(rowsLike('WIDEBRAND STORE 12'), category())
    txn(checking, { description: 'WIDEBRAND STORE 99' })

    expect((await suggestionFor('WIDEBRAND STORE 12'))?.matchCount).toBe(4)
  })

  it('sorts by live count, biggest first', async () => {
    const target = category()
    await categorize(rowsLike('SORT SMALL', 3), target)
    await categorize(rowsLike('SORT BIG', 5), target)

    const names = (await pending())
      .map((s) => s.descriptionKey)
      .filter((d) => d.startsWith('SORT '))
    expect(names).toEqual(['SORT BIG', 'SORT SMALL'])
  })

  it('drops its suggestions when their category is deleted', async () => {
    const target = category()
    await categorize(rowsLike('GONE WITH CATEGORY'), target)
    await api.categories.delete(target)
    expect(await suggestionFor('GONE WITH CATEGORY')).toBeUndefined()
    expect(suggestionRows('GONE WITH CATEGORY')).toBe(0)
  })
})
