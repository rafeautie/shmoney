import { describe, it, expect } from 'vitest'
import { assignExternalIds, annotateDuplicates, type ExistingTransaction } from './dedupe'
import type { ParsedRow } from './parse'

// imported rows anchor calendar dates at local noon (month is 0-based here)
const noon = (y: number, m0: number, d: number): number => new Date(y, m0, d, 12).getTime() / 1000

const DAY = noon(2024, 0, 15)

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return { posted: DAY, amount: -4500, description: 'COFFEE', ...overrides }
}

function existing(overrides: Partial<ExistingTransaction> = {}): ExistingTransaction {
  return { simplefinId: 'sfin-1', posted: DAY, amount: -4500, deletedAt: null, ...overrides }
}

describe('assignExternalIds', () => {
  it('uses FITID directly when present', () => {
    const [r] = assignExternalIds([row({ fitid: 'F123' })])
    expect(r.externalId).toBe('import:fitid:F123')
  })

  it('hashes date|amount|description otherwise, deterministically', () => {
    const [a] = assignExternalIds([row()])
    const [b] = assignExternalIds([row({ description: '  coffee ' })])
    // description is normalized (trim/collapse/lowercase) before hashing
    expect(a.externalId).toBe(b.externalId)
    expect(a.externalId).toMatch(/^import:h1:[0-9a-f]{64}:0$/)
  })

  it('gives identical rows in one file distinct occurrence counters', () => {
    const [a, b] = assignExternalIds([row(), row()])
    expect(a.externalId).not.toBe(b.externalId)
    expect(a.externalId.endsWith(':0')).toBe(true)
    expect(b.externalId.endsWith(':1')).toBe(true)
    // re-parsing the same file reproduces the same ids
    const again = assignExternalIds([row(), row()])
    expect(again.map((r) => r.externalId)).toEqual([a.externalId, b.externalId])
  })

  it('rows differing in amount or day hash differently', () => {
    const [a, b, c] = assignExternalIds([
      row(),
      row({ amount: -4600 }),
      row({ posted: DAY + 86400 })
    ])
    expect(new Set([a.externalId, b.externalId, c.externalId]).size).toBe(3)
  })
})

describe('annotateDuplicates', () => {
  const [imported] = assignExternalIds([row()])

  it('marks exact external-id matches as duplicate, including soft-deleted ones', () => {
    const live = annotateDuplicates([imported], [existing({ simplefinId: imported.externalId })])
    expect(live[0].status).toBe('duplicate')
    const deleted = annotateDuplicates(
      [imported],
      [existing({ simplefinId: imported.externalId, deletedAt: 123, posted: 0, amount: 0 })]
    )
    expect(deleted[0].status).toBe('duplicate')
  })

  it('marks same-day same-amount rows as probable', () => {
    const [r] = annotateDuplicates([imported], [existing()])
    expect(r.status).toBe('probable')
  })

  it('ignores soft-deleted rows for probable matching', () => {
    const [r] = annotateDuplicates([imported], [existing({ deletedAt: 123 })])
    expect(r.status).toBe('new')
  })

  it('each existing row explains at most one import row', () => {
    const two = assignExternalIds([row(), row()])
    const statuses = annotateDuplicates(two, [existing()]).map((r) => r.status)
    expect(statuses.sort()).toEqual(['new', 'probable'])
  })

  it('different day or amount is new', () => {
    const [r] = annotateDuplicates([imported], [existing({ amount: -9900 })])
    expect(r.status).toBe('new')
  })
})
