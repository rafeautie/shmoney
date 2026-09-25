import { describe, expect, it } from 'vitest'
import { fixtureContext, fixtureDb, noon } from './test-fixture'
import { runUnusual } from './unusual'

const flagsOf = (rows: unknown[][] | undefined): { kind: string; merchant: string }[] =>
  (rows ?? []).map((r) => ({ kind: r[0] as string, merchant: r[2] as string }))

describe('unusual', () => {
  const ctx = fixtureContext()

  it('flags this month: the taco duplicate, REI, shopping pace and the Japan goal', () => {
    const { result, chart } = runUnusual({ period: 'this_month' }, ctx)
    expect(result.period).toBe('2026-09 so far')
    const flags = flagsOf(result.rows)
    expect(flags).toContainEqual({ kind: 'possible duplicate', merchant: 'Tacos El Gordo' })
    expect(flags).toContainEqual({ kind: 'new merchant', merchant: 'REI' })
    expect(flags).toContainEqual({ kind: 'goal behind', merchant: 'Trip to Japan' })
    expect(flags.some((f) => f.kind === 'above usual pace' && /Shopping/.test(f.merchant))).toBe(
      true
    )
    // REI is a new merchant, not also a large charge; subscriptions stay quiet
    expect(flags.filter((f) => f.merchant === 'REI')).toHaveLength(1)
    expect(flags.some((f) => /netflix|spotify/i.test(f.merchant))).toBe(false)
    expect(result.facts).toEqual({
      flags: 4,
      by_kind: {
        'possible duplicate': 1,
        'new merchant': 1,
        'above usual pace': 1,
        'goal behind': 1
      },
      total_flagged_spending: 264
    })
    const dates = (result.rows ?? []).map((r) => r[1] as string)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(chart).toBeNull()
  })

  it('finds the July spike as a large charge and Netflix in May as a price change', () => {
    const july = flagsOf(runUnusual({ period: '2026-07' }, ctx).result.rows)
    expect(july).toContainEqual({ kind: 'large charge', merchant: 'Amazon' })
    const may = flagsOf(runUnusual({ period: '2026-05' }, ctx).result.rows)
    expect(may).toEqual([{ kind: 'price change', merchant: 'Netflix' }])
  })

  it('says nothing unusual for a quiet past month', () => {
    const { result } = runUnusual({ period: '2026-02' }, ctx)
    expect(result.rows).toEqual([])
    expect(result.facts).toMatchObject({ flags: 0, total_flagged_spending: 0 })
    expect(result.notes).toEqual(['Nothing unusual in 2026-02.'])
  })

  it('fails on an unknown period', () => {
    expect(runUnusual({ period: 'someday' }, ctx).result.error).toMatch(/Unknown period/)
  })
})

describe('unusual duplicates at the window edge', () => {
  it('flags the charge inside the window and counts only it', () => {
    const before = runUnusual({ period: '2026-08' }, fixtureContext()).result
    const db = fixtureDb()
    const insert = db.prepare(
      `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
       VALUES (3, ?, ?, -37000, 'BOOKSHOP 12', 0, ?, NULL)`
    )
    for (const day of ['2026-08-30', '2026-09-01']) insert.run(`dup${day}`, noon(day), noon(day))
    const { result } = runUnusual({ period: '2026-08' }, fixtureContext(db))
    const dup = result.rows!.filter((r) => r[0] === 'possible duplicate')
    expect(dup).toEqual([
      [
        'possible duplicate',
        '2026-08-30',
        'Bookshop',
        37,
        'Same amount also charged on 2026-09-01.'
      ]
    ])
    expect(result.rows!.every((r) => (r[1] as string) <= '2026-08-31')).toBe(true)
    expect(result.facts!.total_flagged_spending).toBe(
      (before.facts!.total_flagged_spending as number) + 37
    )
  })
})
