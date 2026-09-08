import { describe, expect, it } from 'vitest'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { flowSinceWhere, goalFlowWhere } from './flow'

// asserted as generated SQL, the way balance.test.ts checks balanceDeltaWhere
const dialect = new SQLiteSyncDialect()
function render(clause: ReturnType<typeof goalFlowWhere>): { sql: string; params: unknown[] } {
  const { sql, params } = dialect.sqlToQuery(clause!)
  return { sql: sql.toLowerCase(), params }
}

describe('goalFlowWhere', () => {
  it('counts only transactions after the goal’s own start instant', () => {
    expect(render(goalFlowWhere()).sql).toContain('> "savings_goals"."started_at"')
  })

  it('uses the shared effective-date expression, not posted alone', () => {
    const { sql } = render(goalFlowWhere())
    expect(sql).toContain('coalesce(nullif("transactions"."posted", 0)')
    expect(sql).toContain('"transactions"."transacted_at"')
  })

  it('shares the settled-rows clauses with balanceDeltaWhere', () => {
    const { sql, params } = render(goalFlowWhere())
    expect(sql).toContain('"transactions"."deleted_at" is null')
    expect(sql).toContain('"transactions"."pending" = ?')
    expect(params).toContain(0)
  })

  it('has no category clause: opening balances are savings too', () => {
    const { sql } = render(goalFlowWhere())
    expect(sql).not.toContain('category')
    expect(sql).not.toContain('system_key')
  })

  it('scopes to the given goals, and to all of them when none are given', () => {
    expect(render(goalFlowWhere([3, 4])).sql).toContain(
      '"savings_goal_accounts"."goal_id" in (?, ?)'
    )
    expect(render(goalFlowWhere([3, 4])).params).toEqual(expect.arrayContaining([3, 4]))
    expect(render(goalFlowWhere()).sql).not.toContain('"savings_goal_accounts"."goal_id" in')
  })
})

describe('flowSinceWhere', () => {
  it('takes its cutoff as a bound parameter rather than the stored start', () => {
    const { sql, params } = render(flowSinceWhere(1_700_000_000))
    expect(sql).not.toContain('"savings_goals"."started_at"')
    expect(params).toContain(1_700_000_000)
  })

  it('keeps the same settled-rows and strictly-after rules', () => {
    const { sql } = render(flowSinceWhere(0, [7]))
    expect(sql).toContain('"transactions"."deleted_at" is null')
    expect(sql).toContain('"transactions"."pending" = ?')
    expect(sql).toContain('> ?')
    expect(sql).toContain('"savings_goal_accounts"."goal_id" in (?)')
  })
})
