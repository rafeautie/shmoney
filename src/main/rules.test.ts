import { describe, it, expect } from 'vitest'
import type { Rule, RuleConditions } from '../shared/rules'
import { evaluateRules, matchConditions, type RuleCandidate } from './rules'

// local-time epoch seconds, so day-of-month checks are timezone-stable
const at = (y: number, m: number, d: number): number =>
  Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000)

function candidate(over: Partial<RuleCandidate> = {}): RuleCandidate {
  return {
    id: 1,
    accountId: 1,
    amount: -5000, // $5 out
    description: 'STARBUCKS STORE 123',
    date: at(2026, 7, 15),
    categoryId: null,
    isTransfer: false,
    ...over
  }
}

let nextId = 1
function rule(conditions: RuleConditions, action: Rule['action'], over: Partial<Rule> = {}): Rule {
  return { id: nextId++, name: `rule ${nextId}`, enabled: true, priority: 0, conditions, action, ...over }
}

const coffee: Rule['action'] = { type: 'setCategory', categoryId: 7 }

describe('matchConditions', () => {
  it('description contains is case-insensitive', () => {
    expect(matchConditions({ description: { op: 'contains', value: 'starbucks' } }, candidate())).toBe(true)
    expect(matchConditions({ description: { op: 'contains', value: 'peets' } }, candidate())).toBe(false)
  })

  it('description equals matches the whole string, case-insensitive', () => {
    expect(matchConditions({ description: { op: 'equals', value: 'starbucks store 123' } }, candidate())).toBe(true)
    expect(matchConditions({ description: { op: 'equals', value: 'starbucks' } }, candidate())).toBe(false)
  })

  it('description regex matches, and a bad regex never throws', () => {
    expect(matchConditions({ description: { op: 'regex', value: 'star.*123' } }, candidate())).toBe(true)
    expect(matchConditions({ description: { op: 'regex', value: '(' } }, candidate())).toBe(false)
  })

  it('amount compares magnitude with direction', () => {
    // $5 out
    expect(matchConditions({ amount: { op: 'gte', value: 5000 } }, candidate())).toBe(true)
    expect(matchConditions({ amount: { op: 'gt', value: 5000 } }, candidate())).toBe(false)
    expect(matchConditions({ amount: { op: 'lte', value: 5000, direction: 'out' } }, candidate())).toBe(true)
    // wrong direction: this is money out, not in
    expect(matchConditions({ amount: { op: 'lte', value: 5000, direction: 'in' } }, candidate())).toBe(false)
    expect(matchConditions({ amount: { op: 'between', value: 4000, value2: 6000 } }, candidate())).toBe(true)
    expect(matchConditions({ amount: { op: 'between', value: 6000, value2: 7000 } }, candidate())).toBe(false)
  })

  it('accountId must match exactly', () => {
    expect(matchConditions({ accountId: 1 }, candidate())).toBe(true)
    expect(matchConditions({ accountId: 2 }, candidate())).toBe(false)
  })

  it('date bounds and day-of-month', () => {
    expect(matchConditions({ date: { after: at(2026, 7, 1) } }, candidate())).toBe(true)
    expect(matchConditions({ date: { after: at(2026, 8, 1) } }, candidate())).toBe(false)
    expect(matchConditions({ date: { before: at(2026, 7, 31) } }, candidate())).toBe(true)
    expect(matchConditions({ date: { dayOfMonthMin: 14, dayOfMonthMax: 16 } }, candidate())).toBe(true)
    expect(matchConditions({ date: { dayOfMonthMin: 1, dayOfMonthMax: 10 } }, candidate())).toBe(false)
    // unknown date can't satisfy a date condition
    expect(matchConditions({ date: { after: at(2026, 1, 1) } }, candidate({ date: 0 }))).toBe(false)
  })

  it('all present conditions must match (AND)', () => {
    const cond: RuleConditions = {
      description: { op: 'contains', value: 'starbucks' },
      amount: { op: 'lte', value: 10000, direction: 'out' }
    }
    expect(matchConditions(cond, candidate())).toBe(true)
    expect(matchConditions(cond, candidate({ amount: -20000 }))).toBe(false)
  })
})

describe('evaluateRules', () => {
  it('categorizes only uncategorized, non-transfer rows (fill-empty)', () => {
    const rules = [rule({ description: { op: 'contains', value: 'starbucks' } }, coffee)]
    const rows = [
      candidate({ id: 1 }),
      candidate({ id: 2, categoryId: 9 }), // already categorized
      candidate({ id: 3, isTransfer: true }) // already a transfer
    ]
    const firings = evaluateRules(rules, rows)
    expect(firings).toHaveLength(1)
    expect(firings[0].ids).toEqual([1])
  })

  it('the first rule to act claims a row; later rules skip it', () => {
    const r1 = rule({ description: { op: 'contains', value: 'starbucks' } }, coffee, { priority: 0 })
    const r2 = rule({ description: { op: 'contains', value: 'store' } }, { type: 'markTransfer' }, { priority: 1 })
    const firings = evaluateRules([r1, r2], [candidate({ id: 1 })])
    // r1 categorizes it; r2 must not also mark it a transfer
    expect(firings).toHaveLength(1)
    expect(firings[0].rule.id).toBe(r1.id)
  })

  it('runs rules in priority order', () => {
    const low = rule({ description: { op: 'contains', value: 'starbucks' } }, { type: 'setCategory', categoryId: 1 }, { priority: 5 })
    const high = rule({ description: { op: 'contains', value: 'starbucks' } }, { type: 'setCategory', categoryId: 2 }, { priority: 1 })
    const firings = evaluateRules([low, high], [candidate({ id: 1 })])
    expect(firings[0].rule.id).toBe(high.id) // priority 1 wins the row
  })

  it('skips disabled rules', () => {
    const off = rule({ description: { op: 'contains', value: 'starbucks' } }, coffee, { enabled: false })
    expect(evaluateRules([off], [candidate()])).toHaveLength(0)
  })

  it('markTransfer only touches unmarked rows', () => {
    const r = rule({ description: { op: 'contains', value: 'starbucks' } }, { type: 'markTransfer' })
    const firings = evaluateRules([r], [candidate({ id: 1 }), candidate({ id: 2, isTransfer: true })])
    expect(firings).toHaveLength(1)
    expect(firings[0].ids).toEqual([1])
  })
})
