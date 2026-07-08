import { describe, it, expect } from 'vitest'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { RuleConditions } from '../shared/rules'
import { compileConditions } from './rules'

// Matching now runs in the database: compileConditions builds a parameterized
// SQL predicate rather than testing rows in JS. better-sqlite3 is built for
// Electron's ABI and won't load under vitest, so we assert the generated SQL and
// its bound params here; end-to-end matching is validated in the running app.
const dialect = new SQLiteSyncDialect()
function compile(conditions: RuleConditions): { sql: string; params: unknown[] } {
  const { sql, params } = dialect.sqlToQuery(compileConditions(conditions))
  return { sql: sql.toLowerCase(), params }
}

describe('compileConditions', () => {
  describe('description', () => {
    it('contains is a case-insensitive LIKE with escaped wildcards', () => {
      const { sql, params } = compile({ description: { op: 'contains', phrases: ['Star%bucks'] } })
      expect(sql).toContain('like lower(')
      expect(sql).toContain('escape')
      // % and _ in a phrase are escaped so they match literally
      expect(params).toEqual(['%Star\\%bucks%'])
    })

    it('contains matches ANY phrase (OR)', () => {
      const { sql, params } = compile({
        description: { op: 'contains', phrases: ['starbucks', 'sbux'] }
      })
      expect(sql).toContain(' or ')
      expect(params).toEqual(['%starbucks%', '%sbux%'])
    })

    it('equals compares the whole string, case-insensitive', () => {
      const { sql, params } = compile({
        description: { op: 'equals', phrases: ['starbucks store 123'] }
      })
      expect(sql).toContain('lower(')
      expect(sql).toContain('=')
      expect(params).toEqual(['starbucks store 123'])
    })

    it('equals matches ANY phrase (OR)', () => {
      const { sql, params } = compile({ description: { op: 'equals', phrases: ['a', 'b'] } })
      expect(sql).toContain(' or ')
      expect(params).toEqual(['a', 'b'])
    })
  })

  describe('amount', () => {
    it('compares magnitude for each operator', () => {
      const gte = compile({ amount: { op: 'gte', value: 5000 } })
      expect(gte.sql).toContain('abs(')
      expect(gte.sql).toContain('>=')
      expect(gte.params).toContain(5000)

      const between = compile({ amount: { op: 'between', value: 4000, value2: 6000 } })
      expect(between.params).toEqual([4000, 6000])
    })

    it('adds a direction guard', () => {
      expect(compile({ amount: { op: 'lte', value: 5000, direction: 'out' } }).sql).toContain('< 0')
      expect(compile({ amount: { op: 'lte', value: 5000, direction: 'in' } }).sql).toContain('> 0')
    })
  })

  describe('date', () => {
    it('excludes unknown dates and applies bounds', () => {
      const { sql, params } = compile({ date: { after: 1000, before: 2000 } })
      expect(sql).toContain('!= 0')
      expect(params).toEqual(expect.arrayContaining([1000, 2000]))
    })

    it('day-of-month uses local-time strftime', () => {
      const { sql, params } = compile({ date: { dayOfMonthMin: 14, dayOfMonthMax: 16 } })
      expect(sql).toContain("strftime('%d'")
      expect(sql).toContain('localtime')
      expect(params).toEqual(expect.arrayContaining([14, 16]))
    })
  })

  it('account matches exactly', () => {
    expect(compile({ accountId: 7 }).params).toContain(7)
  })

  it('ANDs every present condition', () => {
    const { sql, params } = compile({
      description: { op: 'contains', phrases: ['starbucks'] },
      amount: { op: 'lte', value: 10000, direction: 'out' }
    })
    expect(sql).toContain(' and ')
    expect(params).toEqual(expect.arrayContaining(['%starbucks%', 10000]))
  })
})
