import { describe, expect, it } from 'vitest'
import { widgetConfigSchema } from './reports'

describe('widgetConfigSchema with the goal source added', () => {
  const stored = {
    query: { measure: 'expense', groupBy: 'category', timeGrain: 'month', cumulative: false },
    filters: { mode: 'inherit', overrides: {} }
  }

  it('still parses a config written before the source existed', () => {
    const parsed = widgetConfigSchema.parse(stored)
    expect(parsed.query.source).toBe('transactions')
    expect(parsed.query.goalIds).toBeUndefined()
  })

  it('keeps a goal source and its selection', () => {
    const parsed = widgetConfigSchema.parse({
      ...stored,
      query: { ...stored.query, source: 'goals', goalIds: [4] }
    })
    expect(parsed.query.source).toBe('goals')
    expect(parsed.query.goalIds).toEqual([4])
  })

  it('rejects a source it has no reading for', () => {
    expect(
      widgetConfigSchema.safeParse({ ...stored, query: { ...stored.query, source: 'budgets' } })
        .success
    ).toBe(false)
  })
})
