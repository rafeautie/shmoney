import { describe, expect, it } from 'vitest'
import type { Proposal } from '@shared/chat'
import { matchesAsked, runAction } from './actions'
import { addEuroCard, fixtureContext, fixtureDb, noon } from './test-fixture'

const recategorize = (args: Record<string, unknown>): ReturnType<typeof runAction> =>
  runAction(
    'recategorize',
    { to_category: null, search: null, from_category: null, period: 'all', account: null, ...args },
    fixtureContext()
  )

function proposal<K extends Proposal['kind']>(
  out: ReturnType<typeof runAction>,
  kind: K
): Extract<Proposal, { kind: K }> {
  expect(out.result.ok).toBe(true)
  expect(out.display?.status).toBe('approval-requested')
  expect(out.display).toMatchObject({ actionId: null, applied: null, skipped: null })
  const p = out.display!.proposal
  expect(p.kind).toBe(kind)
  return p as Extract<Proposal, { kind: K }>
}

describe('recategorize', () => {
  it('groups matching rows by merchant and summarizes them', () => {
    const out = recategorize({
      to_category: '🛒 Groceries',
      search: 'blue bottle',
      period: '2026-08'
    })
    const p = proposal(out, 'recategorize')
    expect(p.toCategory).toBe('🛒 Groceries')
    expect(p.groups).toEqual([
      {
        merchant: 'Blue Bottle Coffee',
        transactionIds: expect.any(Array),
        fromCategoryIds: expect.any(Array),
        total: -26
      }
    ])
    expect(p.groups[0].transactionIds).toHaveLength(4)
    // each row's preview category rides along, so apply can skip rows edited since
    expect(p.groups[0].fromCategoryIds).toHaveLength(4)
    expect(p.groups[0].fromCategoryIds!.every((id) => typeof id === 'number')).toBe(true)
    expect(p.sample.map((s) => s.date)).toEqual([
      '2026-08-23',
      '2026-08-16',
      '2026-08-09',
      '2026-08-02'
    ])
    expect(p.sample[0]).toMatchObject({ amount: -6.5, category: '🍽️ Dining Out' })
    expect(p.currency).toBe('USD')
    expect(out.result.summary).toBe(
      'Proposed moving 4 transactions (Blue Bottle Coffee 4) totaling 26.00 to 🛒 Groceries.'
    )
    expect(out.result.note).toMatch(/Do not call more tools/)
  })

  it("reads from_category 'Uncategorized' as no category", () => {
    const p = proposal(
      recategorize({ to_category: '🛍️ Shopping', from_category: 'Uncategorized' }),
      'recategorize'
    )
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]).toMatchObject({ total: -32, fromCategoryIds: [null] })
    expect(p.sample).toHaveLength(1)
    expect(p.sample[0]).toMatchObject({ description: 'MYSTERY MERCHANT 991', category: null })
  })

  it('narrows by a from category and an account', () => {
    const p = proposal(
      recategorize({
        to_category: '🛒 Groceries',
        from_category: '🍽️ Dining Out',
        account: 'Rewards Visa',
        period: '2026-08'
      }),
      'recategorize'
    )
    expect(p.groups.map((g) => [g.merchant, g.transactionIds.length])).toEqual([
      ['Blue Bottle Coffee', 4],
      ['Tacos El Gordo', 1]
    ])
  })

  it('leaves out rows already in the target category', () => {
    const out = recategorize({ to_category: '🛍️ Shopping', search: 'amazon' })
    expect(out.result.ok).toBe(false)
    expect(out.display).toBeNull()
    expect(out.result.error).toMatch(/matching 'amazon'.*outside 🛍️ Shopping/)
  })

  it('rejects an unknown category and a bad period', () => {
    expect(recategorize({ to_category: 'Nope' }).result.error).toMatch(/no category named 'Nope'/)
    expect(recategorize({ to_category: '🛍️ Shopping', period: 'soon' }).result.error).toMatch(
      /Unknown period/
    )
  })

  it('refuses a category name shared by two groups instead of guessing', () => {
    const db = fixtureDb()
    const group = db.prepare("INSERT INTO main.category_groups (name) VALUES ('Extras')").run()
    db.prepare("INSERT INTO main.categories (group_id, name) VALUES (?, '🛒 Groceries')").run(
      group.lastInsertRowid
    )
    const ctx = fixtureContext(db)
    const args = { search: null, period: 'all', account: null }
    for (const out of [
      runAction('recategorize', { ...args, to_category: '🛒 Groceries', from_category: null }, ctx),
      runAction(
        'recategorize',
        { ...args, to_category: '🛍️ Shopping', from_category: '🛒 Groceries' },
        ctx
      ),
      runAction('set_budget', { category: '🛒 Groceries', amount: 400, from_month: null }, ctx)
    ]) {
      expect(out.display).toBeNull()
      expect(out.result.error).toMatch(/More than one category is named '🛒 Groceries'/)
      expect(out.result.error).toMatch(/'Extras'/)
    }
  })

  it('asks to narrow past 500 rows', () => {
    const db = fixtureDb()
    const insert = db.prepare(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at)
       VALUES (3, ?, ?, -1000, 'BULK SHOP', 0, ?)`
    )
    for (let i = 0; i < 501; i++) insert.run(`bulk${i}`, noon('2026-08-10'), noon('2026-08-10'))
    const out = runAction(
      'recategorize',
      {
        to_category: '🛍️ Shopping',
        search: 'bulk',
        from_category: null,
        period: 'all',
        account: null
      },
      fixtureContext(db)
    )
    expect(out.result.error).toMatch(/501 transactions matched, more than 500/)
  })
})

describe('set_budget', () => {
  const setBudget = (args: Record<string, unknown>): ReturnType<typeof runAction> =>
    runAction('set_budget', { from_month: null, ...args }, fixtureContext())

  it('shows the fill in effect and the recent average', () => {
    const out = setBudget({ category: '🍽️ Dining Out', amount: 300 })
    const p = proposal(out, 'set_budget')
    expect(p).toMatchObject({
      category: '🍽️ Dining Out',
      month: '2026-09',
      before: 60,
      after: 300,
      averageSpending: 50,
      currency: 'USD'
    })
    expect(out.result.summary).toBe(
      'Proposed a 🍽️ Dining Out budget of 300.00 a month from 2026-09 (now 60.00).'
    )
  })

  it('reads the fill at from_month, null before the first one', () => {
    const p = proposal(
      setBudget({ category: '🍽️ Dining Out', amount: 80, from_month: '2026-05' }),
      'set_budget'
    )
    expect(p.before).toBeNull()
    const shopping = setBudget({ category: '🛍️ Shopping', amount: 100 })
    expect(proposal(shopping, 'set_budget').before).toBeNull()
    expect(shopping.result.summary).toMatch(/no budget now/)
  })

  it('rejects system categories, bad amounts and months', () => {
    expect(setBudget({ category: '💵 Income', amount: 100 }).result.error).toMatch(
      /system category/
    )
    expect(setBudget({ category: '🛍️ Shopping', amount: 0 }).result.error).toMatch(/more than 0/)
    expect(
      setBudget({ category: '🛍️ Shopping', amount: 50, from_month: '2026-13' }).result.error
    ).toMatch(/YYYY-MM/)
    expect(setBudget({ category: 'Nope', amount: 50 }).result.error).toMatch(/no category/)
  })
})

describe('update_goal', () => {
  const updateGoal = (args: Record<string, unknown>): ReturnType<typeof runAction> =>
    runAction(
      'update_goal',
      { target_amount: null, target_date: null, archived: null, ...args },
      fixtureContext()
    )

  it('reruns the pace math for a new target date', () => {
    const out = updateGoal({ goal: 'Trip to Japan', target_date: '2027-06-30' })
    const p = proposal(out, 'update_goal')
    expect(p.before).toEqual({ targetAmount: 6000, targetDate: '2027-03-31', archived: false })
    expect(p.after).toEqual({ targetAmount: 6000, targetDate: '2027-06-30', archived: false })
    expect(p.pace.before.neededPerMonth).toBeCloseTo(3500 / 6, 2)
    expect(p.pace.after.neededPerMonth).toBeCloseTo(3500 / 9, 2)
    expect(p.pace.before.status).toBe('Behind')
    expect(p.pace.after.status).toBe('On track')
    expect(p.currency).toBe('USD')
    expect(out.result.summary).toBe(
      "Proposed moving Trip to Japan's target date to 2027-06-30; it would need 388.89 a month and be On track."
    )
  })

  it('changes the target amount', () => {
    const out = updateGoal({ goal: 'Emergency fund', target_amount: 28000 })
    const p = proposal(out, 'update_goal')
    expect(p.after.targetAmount).toBe(28000)
    expect(out.result.summary).toMatch(/Emergency fund's target to 28000\.00/)
  })

  it('archives a goal', () => {
    const out = updateGoal({ goal: 'Emergency fund', archived: true })
    expect(proposal(out, 'update_goal').after.archived).toBe(true)
    expect(out.result.summary).toBe('Proposed archiving Emergency fund.')
  })

  it('rejects unknown goals, no-ops and bad dates', () => {
    expect(updateGoal({ goal: 'Boat' }).result.error).toMatch(/no active savings goal/)
    expect(updateGoal({ goal: 'Trip to Japan' }).result.error).toMatch(/wouldn't change/)
    expect(updateGoal({ goal: 'Trip to Japan', target_date: '2027-03-31' }).result.error).toMatch(
      /wouldn't change/
    )
    expect(updateGoal({ goal: 'Trip to Japan', target_date: '2026-09-01' }).result.error).toMatch(
      /after 2026-09-24/
    )
    expect(updateGoal({ goal: 'Trip to Japan', target_date: '2027-02-30' }).result.error).toMatch(
      /YYYY-MM-DD/
    )
    expect(updateGoal({ goal: 'Trip to Japan', target_amount: -5 }).result.error).toMatch(
      /more than 0/
    )
  })

  it('checks the target date when archiving too, allowing only a past one', () => {
    const archive = (target_date: string): ReturnType<typeof runAction> =>
      updateGoal({ goal: 'Trip to Japan', target_date, archived: true })
    expect(archive('2027-02-30').result.error).toMatch(/YYYY-MM-DD/)
    // the goal started 2026-04-01
    expect(archive('2026-03-15').result.error).toMatch(/after the goal's start/)
    expect(proposal(archive('2026-08-31'), 'update_goal').after).toMatchObject({
      targetDate: '2026-08-31',
      archived: true
    })
  })
})

describe('as_asked guard', () => {
  it.each([
    ['eating out', '🍽️ Dining Out', true],
    ['restaurants', '🍽️ Dining Out', true],
    ['grocery', '🛒 Groceries', true],
    ['rent', '🏠 Housing', true],
    ['pet supplies', '🛍️ Shopping', false],
    ['Pets', '🛒 Groceries', false]
  ])('%s -> %s is %s', (asked, category, ok) => expect(matchesAsked(asked, category)).toBe(ok))

  it('refuses a budget for a category the user never named', () => {
    const out = runAction(
      'set_budget',
      { as_asked: 'pet supplies', category: '🛍️ Shopping', amount: 200, from_month: null },
      fixtureContext()
    )
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toContain("No category matches 'pet supplies'")
  })
})

describe('as_asked naming the merchant', () => {
  it('still proposes when the model put the merchant in as_asked', () => {
    const out = runAction(
      'recategorize',
      {
        as_asked: 'Tacos El Gordo',
        to_category: '🛍️ Shopping',
        search: 'tacos el gordo',
        from_category: null,
        period: 'all',
        account: null
      },
      fixtureContext()
    )
    expect(out.result.ok).toBe(true)
  })
})

describe('set_budget with spending in another currency', () => {
  it('averages the main currency and says what it left out', () => {
    const db = fixtureDb()
    addEuroCard(db, [
      { day: '2026-07-04', amount: -80, description: 'CAFE DE FLORE', category: '🍽️ Dining Out' }
    ])
    const out = runAction(
      'set_budget',
      { category: '🍽️ Dining Out', amount: 300, from_month: null },
      fixtureContext(db)
    )
    expect(proposal(out, 'set_budget')).toMatchObject({ averageSpending: 50, currency: 'USD' })
    expect(out.result.summary).toBe(
      'Proposed a 🍽️ Dining Out budget of 300.00 a month from 2026-09 (now 60.00). Only USD amounts are counted; EUR was left out, since currencies are never added together.'
    )
  })
})
