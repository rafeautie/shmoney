import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CategorizeProgress } from '@shared/llm'
import { db } from '../../demo/db'
import { rules } from '../db/schema'
import { api } from './harness/api'
import { account, category, rule, systemCategory, txn } from './harness/builders'
import { count, query, snapshot } from './harness/db'
import { fakeLlm } from './harness/fakes/llm'

let checking: number
let savings: number
let groceries: number
let dining: number

type Answer = { categoryId: number; reason: string }
type Schema = { properties: { categoryId: { enum: number[] } } }

const categoryOf = (id: number): number | null =>
  query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c

const descriptionIn = (prompt: string): string => /Description: "(.*)"/.exec(prompt)![1]

const answer = (categoryId: number, reason = 'a reason'): Answer => ({ categoryId, reason })

/** answers by description and records which descriptions the model was asked about */
function script(byDescription: Record<string, unknown>): string[] {
  const asked: string[] = []
  fakeLlm.onGenerate((_feature, prompt) => {
    const description = descriptionIn(prompt)
    asked.push(description)
    const result = byDescription[description]
    if (result instanceof Error) throw result
    return result
  })
  return asked
}

/** parks the first generate on a gate the spec opens, so a run can be held mid-flight */
function gated(): { entered: Promise<void>; open: (value: unknown) => void } {
  let enter!: () => void
  let open!: (value: unknown) => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  const gate = new Promise<unknown>((resolve) => (open = resolve))
  fakeLlm.onGenerate(async () => {
    enter()
    return gate
  })
  return { entered, open }
}

function progressOf(): { seen: CategorizeProgress[]; stop: () => void } {
  const seen: CategorizeProgress[] = []
  const stop = api.llm.onCategorizeProgress((p) => seen.push(p))
  return { seen, stop }
}

// every test owns its rows: scope "all" would otherwise sweep up earlier tests'
beforeEach(() => {
  query('DELETE FROM action_log_transactions')
  query('DELETE FROM action_log')
  query('DELETE FROM action_runs')
  query('DELETE FROM transactions')
  db.delete(rules).run()
  fakeLlm.ready()
})

beforeAll(() => {
  checking = account({ name: 'Cat checking' })
  savings = account({ name: 'Cat savings' })
  groceries = category('Cat groceries')
  dining = category('Cat dining')
})

describe('scope', () => {
  it('an explicit id list wins over an account, which is ignored', async () => {
    const mine = txn(checking, { description: 'IDS ONLY' })
    const other = txn(savings, { description: 'OTHER ACCOUNT' })
    const untouched = txn(checking, { description: 'NOT SELECTED' })
    const asked = script({ 'IDS ONLY': answer(groceries), 'OTHER ACCOUNT': answer(dining) })

    const result = await api.llm.categorize({ transactionIds: [mine], accountId: savings })

    expect(result).toEqual({ categorized: 1, cancelled: false })
    expect(asked).toEqual(['IDS ONLY'])
    expect(categoryOf(mine)).toBe(groceries)
    expect(categoryOf(other)).toBeNull()
    expect(categoryOf(untouched)).toBeNull()
  })

  it('an account scope covers only that account', async () => {
    const inChecking = txn(checking, { description: 'IN CHECKING' })
    const inSavings = txn(savings, { description: 'IN SAVINGS' })
    const asked = script({ 'IN SAVINGS': answer(dining) })

    const result = await api.llm.categorize({ accountId: savings })

    expect(result).toEqual({ categorized: 1, cancelled: false })
    expect(asked).toEqual(['IN SAVINGS'])
    expect(categoryOf(inSavings)).toBe(dining)
    expect(categoryOf(inChecking)).toBeNull()
  })

  it('no scope covers every account', async () => {
    const a = txn(checking, { description: 'ALL A' })
    const b = txn(savings, { description: 'ALL B' })
    script({ 'ALL A': answer(groceries), 'ALL B': answer(dining) })

    expect(await api.llm.categorize()).toEqual({ categorized: 2, cancelled: false })
    expect([categoryOf(a), categoryOf(b)]).toEqual([groceries, dining])
  })

  it('an empty id list is rejected before anything runs', async () => {
    txn(checking, { description: 'UNTOUCHED' })
    const asked = script({})
    await expect(api.llm.categorize({ transactionIds: [] })).rejects.toThrow()
    await expect(api.llm.categorize({ accountId: 0 })).rejects.toThrow()
    expect(asked).toEqual([])
  })

  it('never offers pending, deleted or already categorized rows', async () => {
    txn(checking, { description: 'PENDING ROW', pending: true })
    txn(checking, { description: 'DELETED ROW', deletedAt: 1_700_000_000 })
    txn(checking, { description: 'FILED ROW', categoryId: dining })
    const eligible = txn(checking, { description: 'ELIGIBLE ROW' })
    const asked = script({ 'ELIGIBLE ROW': answer(groceries) })

    const result = await api.llm.categorize()

    expect(asked).toEqual(['ELIGIBLE ROW'])
    expect(result.categorized).toBe(1)
    expect(categoryOf(eligible)).toBe(groceries)
  })

  it('leaves an explicitly selected ineligible row alone', async () => {
    const pending = txn(checking, { description: 'PENDING PICK', pending: true })
    const filed = txn(checking, { description: 'FILED PICK', categoryId: dining })
    const asked = script({})

    const result = await api.llm.categorize({ transactionIds: [pending, filed] })

    expect(result).toEqual({ categorized: 0, cancelled: false })
    expect(asked).toEqual([])
    expect(categoryOf(filed)).toBe(dining)
    expect(categoryOf(pending)).toBeNull()
  })
})

describe('offered categories', () => {
  it('excludes Transfers and Starting balance, includes Income and user categories', async () => {
    txn(checking, { description: 'SCHEMA PROBE' })
    let schema: Schema | undefined
    let prompt = ''
    fakeLlm.onGenerate((_feature, p, s) => {
      prompt = p
      schema = s as Schema
      return answer(groceries)
    })

    await api.llm.categorize()

    const offered = schema!.properties.categoryId.enum
    expect(offered).not.toContain(systemCategory('transfers'))
    expect(offered).not.toContain(systemCategory('opening'))
    expect(offered).toEqual(expect.arrayContaining([systemCategory('income'), groceries, dining]))
    expect(prompt).toContain(`${groceries} = Cat groceries`)
    expect(prompt).not.toContain(`${systemCategory('transfers')} = `)
  })

  it('asks for reason before categoryId, both required', async () => {
    txn(checking, { description: 'SHAPE PROBE' })
    let schema: { required: string[]; properties: object } | undefined
    fakeLlm.onGenerate((_feature, _prompt, s) => {
      schema = s as typeof schema
      return answer(groceries)
    })

    await api.llm.categorize()

    expect(Object.keys(schema!.properties)).toEqual(['reason', 'categoryId'])
    expect(schema!.required).toEqual(['reason', 'categoryId'])
  })

  it('tags the model request as the categorize feature', async () => {
    txn(checking, { description: 'FEATURE PROBE' })
    const features: string[] = []
    fakeLlm.onGenerate((feature) => {
      features.push(feature)
      return answer(groceries)
    })
    await api.llm.categorize()
    expect(features).toEqual(['categorize'])
  })
})

describe('grouping and bad answers', () => {
  it('makes one generate call per distinct description and fills every row in the group', async () => {
    const coffee = [1, 2, 3].map(() => txn(checking, { description: 'COFFEE SHOP' }))
    const lunch = txn(savings, { description: 'LUNCH SPOT' })
    const asked = script({ 'COFFEE SHOP': answer(dining), 'LUNCH SPOT': answer(groceries) })

    const result = await api.llm.categorize()

    expect(asked).toEqual(['COFFEE SHOP', 'LUNCH SPOT'])
    expect(result.categorized).toBe(4)
    expect(coffee.map(categoryOf)).toEqual([dining, dining, dining])
    expect(categoryOf(lunch)).toBe(groceries)
  })

  it('skips only the group whose id is outside the offered set', async () => {
    const bad = txn(checking, { description: 'WANTS TRANSFERS' })
    const missing = txn(checking, { description: 'WANTS NOTHING' })
    const good = txn(checking, { description: 'FINE ROW' })
    script({
      'WANTS TRANSFERS': answer(systemCategory('transfers')),
      'WANTS NOTHING': answer(987_654),
      'FINE ROW': answer(groceries)
    })

    const result = await api.llm.categorize()

    expect(result.categorized).toBe(1)
    expect([categoryOf(bad), categoryOf(missing), categoryOf(good)]).toEqual([
      null,
      null,
      groceries
    ])
  })

  it('skips only the group whose answer fails to parse', async () => {
    const wrongShape = txn(checking, { description: 'WRONG SHAPE' })
    const noReason = txn(checking, { description: 'NO REASON' })
    const stringId = txn(checking, { description: 'STRING ID' })
    const good = txn(checking, { description: 'PARSES FINE' })
    script({
      'WRONG SHAPE': 'dining please',
      'NO REASON': { categoryId: groceries },
      'STRING ID': { categoryId: String(groceries), reason: 'x' },
      'PARSES FINE': answer(dining)
    })

    const result = await api.llm.categorize()

    expect(result.categorized).toBe(1)
    expect([wrongShape, noReason, stringId].map(categoryOf)).toEqual([null, null, null])
    expect(categoryOf(good)).toBe(dining)
  })

  it('skips only the group whose generation throws', async () => {
    const boom = txn(checking, { description: 'THROWS' })
    const good = txn(checking, { description: 'AFTER THE THROW' })
    script({ THROWS: new Error('decode failed'), 'AFTER THE THROW': answer(groceries) })

    const result = await api.llm.categorize()

    expect(result).toEqual({ categorized: 1, cancelled: false })
    expect(categoryOf(boom)).toBeNull()
    expect(categoryOf(good)).toBe(groceries)
  })

  it('is not stuck busy after a run whose every generation failed', async () => {
    txn(checking, { description: 'ALL FAIL' })
    script({ 'ALL FAIL': new Error('nope') })
    expect(await api.llm.categorize()).toEqual({ categorized: 0, cancelled: false })
    expect(await api.llm.categorize()).toEqual({ categorized: 0, cancelled: false })
  })

  it('writes no action-log entry or run when the model settled nothing', async () => {
    txn(checking, { description: 'NOTHING SETTLED' })
    script({ 'NOTHING SETTLED': 'garbage' })

    await api.llm.categorize()

    expect(count('action_log')).toBe(0)
    expect(count('action_runs')).toBe(0)
  })
})

describe('progress', () => {
  it('pushes one update per group, skipped groups included', async () => {
    txn(checking, { description: 'FIRST' })
    txn(checking, { description: 'SECOND' })
    txn(checking, { description: 'SECOND' })
    txn(checking, { description: 'THIRD' })
    script({ FIRST: answer(groceries), SECOND: new Error('x'), THIRD: answer(dining) })
    const { seen, stop } = progressOf()

    await api.llm.categorize()
    stop()

    expect(seen).toEqual([
      { processed: 1, total: 3 },
      { processed: 2, total: 3 },
      { processed: 3, total: 3 }
    ])
  })

  it('stops pushing once the subscription is cancelled', async () => {
    txn(checking, { description: 'QUIET' })
    script({ QUIET: answer(groceries) })
    const { seen, stop } = progressOf()
    stop()
    await api.llm.categorize()
    expect(seen).toEqual([])
  })

  it('pushes nothing when there is nothing to categorize', async () => {
    script({})
    const { seen, stop } = progressOf()
    await api.llm.categorize()
    stop()
    expect(seen).toEqual([])
  })
})

describe('concurrency and cancel', () => {
  it('rejects a second run while one is in flight, then accepts one after', async () => {
    const first = txn(checking, { description: 'HELD ROW' })
    const gate = gated()
    const running = api.llm.categorize()
    await gate.entered

    await expect(api.llm.categorize()).rejects.toThrow(/already in progress/)
    await expect(api.llm.categorize({ accountId: checking })).rejects.toThrow(/already in progress/)

    gate.open(answer(groceries))
    expect(await running).toEqual({ categorized: 1, cancelled: false })
    expect(categoryOf(first)).toBe(groceries)

    const second = txn(checking, { description: 'AFTER THE GATE' })
    script({ 'AFTER THE GATE': answer(dining) })
    expect(await api.llm.categorize()).toEqual({ categorized: 1, cancelled: false })
    expect(categoryOf(second)).toBe(dining)
  })

  it('cancel mid-run keeps the groups already answered and reports cancelled', async () => {
    const done = txn(checking, { description: 'DONE BEFORE CANCEL' })
    const interrupted = txn(checking, { description: 'INTERRUPTED' })
    const never = txn(checking, { description: 'NEVER STARTED' })
    let enter!: () => void
    const entered = new Promise<void>((resolve) => (enter = resolve))
    const asked: string[] = []
    fakeLlm.onGenerate(async (_feature, prompt) => {
      const description = descriptionIn(prompt)
      asked.push(description)
      if (description === 'DONE BEFORE CANCEL') return answer(groceries)
      enter()
      await new Promise((resolve) => setTimeout(resolve, 20))
      throw new Error('aborted')
    })

    const running = api.llm.categorize()
    await entered
    await api.llm.cancelCategorize()
    const result = await running

    expect(result).toEqual({ categorized: 1, cancelled: true })
    expect(asked).toEqual(['DONE BEFORE CANCEL', 'INTERRUPTED'])
    expect(categoryOf(done)).toBe(groceries)
    expect(categoryOf(interrupted)).toBeNull()
    expect(categoryOf(never)).toBeNull()
    // the partial result is one undoable llm entry
    expect(count('action_log', "source = 'llm'")).toBe(1)
  })

  it('cancel with nothing in flight is a no-op, and a later run is not cancelled', async () => {
    await api.llm.cancelCategorize()
    txn(checking, { description: 'AFTER STRAY CANCEL' })
    script({ 'AFTER STRAY CANCEL': answer(groceries) })
    expect(await api.llm.categorize()).toEqual({ categorized: 1, cancelled: false })
  })
})

describe('rules pre-pass and the action-log run', () => {
  it('rules settle their rows first, so the model only sees the rest', async () => {
    const payroll = txn(checking, { description: 'ACME PAYROLL' })
    const latte = txn(checking, { description: 'LATTE BAR' })
    const salary = category('Cat salary')
    rule('Payroll', 'PAYROLL', salary)
    const asked = script({ 'LATTE BAR': answer(dining) })

    const result = await api.llm.categorize()

    expect(asked).toEqual(['LATTE BAR'])
    expect(result).toEqual({ categorized: 2, cancelled: false })
    expect(categoryOf(payroll)).toBe(salary)
    expect(categoryOf(latte)).toBe(dining)
  })

  it('applies the rules pre-pass inside the same scope rules as the model', async () => {
    const salary = category('Cat salary scoped')
    rule('Payroll scoped', 'PAYROLL', salary)
    const inScope = txn(checking, { description: 'PAYROLL IN' })
    const outOfScope = txn(savings, { description: 'PAYROLL OUT' })
    script({})

    const result = await api.llm.categorize({ transactionIds: [inScope] })

    expect(result.categorized).toBe(1)
    expect(categoryOf(inScope)).toBe(salary)
    expect(categoryOf(outOfScope)).toBeNull()
  })

  it('records rule entries then one llm entry in a single ai-categorize run', async () => {
    const salary = category('Cat salary run')
    const rent = category('Cat rent run')
    rule('Payroll run', 'PAYROLL', salary, 0)
    rule('Rent run', 'LANDLORD', rent, 1)
    txn(checking, { description: 'ACME PAYROLL' })
    txn(checking, { description: 'LANDLORD LLC' })
    txn(checking, { description: 'LATTE BAR' })
    txn(checking, { description: 'BAKERY' })
    script({ 'LATTE BAR': answer(dining), BAKERY: answer(groceries) })

    await api.llm.categorize()

    expect(count('action_runs')).toBe(1)
    const run = query<{ id: number; trigger: string; label: string }>(
      'SELECT id, trigger, label FROM action_runs'
    )[0]
    expect(run).toMatchObject({ trigger: 'ai-categorize', label: 'AI categorization' })
    const entries = query<{ source: string; run_id: number }>(
      'SELECT source, run_id FROM action_log ORDER BY id'
    )
    expect(entries.map((e) => e.source)).toEqual(['rule', 'rule', 'llm'])
    expect(new Set(entries.map((e) => e.run_id))).toEqual(new Set([run.id]))
  })

  it('leaves no run when nothing was categorized at all', async () => {
    txn(checking, { description: 'UNSETTLED' })
    script({})
    await api.llm.categorize()
    expect(count('action_runs')).toBe(0)
  })

  it('a rules-only run still forms a run', async () => {
    const salary = category('Cat salary only')
    rule('Payroll only', 'PAYROLL', salary)
    txn(checking, { description: 'PAYROLL ONLY' })
    script({})

    expect(await api.llm.categorize()).toEqual({ categorized: 1, cancelled: false })
    expect(query('SELECT trigger FROM action_runs')).toEqual([{ trigger: 'ai-categorize' }])
    expect(query('SELECT source FROM action_log')).toEqual([{ source: 'rule' }])
  })

  it('undoing the run reverts the rules and the model together, redo restores them', async () => {
    const salary = category('Cat salary undo')
    rule('Payroll undo', 'PAYROLL', salary)
    const rows = [
      txn(checking, { description: 'ACME PAYROLL' }),
      txn(checking, { description: 'LATTE BAR' }),
      txn(savings, { description: 'LATTE BAR' })
    ]
    script({ 'LATTE BAR': answer(dining) })
    const before = snapshot()

    await api.llm.categorize()
    const after = snapshot()
    expect(after).not.toEqual(before)
    expect(rows.map(categoryOf)).toEqual([salary, dining, dining])
    const runId = query<{ id: number }>('SELECT id FROM action_runs')[0].id

    const undone = await api.actionLog.undoRun(runId)
    expect(undone).toMatchObject({ runId, entries: 2, applied: 3 })
    expect(snapshot()).toEqual(before)
    expect(rows.map(categoryOf)).toEqual([null, null, null])

    const redone = await api.actionLog.redoRun(runId)
    expect(redone).toMatchObject({ runId, entries: 2, applied: 3 })
    expect(snapshot()).toEqual(after)
  })
})

describe('without a model', () => {
  it('rejects up front, before the rules pre-pass, and writes nothing', async () => {
    const salary = category('Cat salary no model')
    rule('Payroll no model', 'PAYROLL', salary)
    const rows = [
      txn(checking, { description: 'ACME PAYROLL' }),
      txn(checking, { description: 'LATTE BAR' })
    ]
    const asked = script({ 'LATTE BAR': answer(dining) })
    const before = snapshot()

    fakeLlm.setStage('notDownloaded')
    await expect(api.llm.categorize()).rejects.toThrow('Model is not ready (notDownloaded)')
    fakeLlm.setStage('downloading')
    await expect(api.llm.categorize()).rejects.toThrow('Model is not ready (downloading)')

    expect(snapshot()).toEqual(before)
    expect(rows.map(categoryOf)).toEqual([null, null])
    expect([count('action_runs'), count('action_log')]).toEqual([0, 0])
    expect(asked).toEqual([])

    // the gate holds no lock: a run goes through once the model is on disk
    fakeLlm.ready()
    expect(await api.llm.categorize()).toEqual({ categorized: 2, cancelled: false })
  })
})
