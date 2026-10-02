import { describe, expect, it } from 'vitest'
import type { ActionLogEntry, ActionRun, ActionSource } from '@shared/ipc'
import { buildFeed, itemIsNew, runSummary } from './activity-feed'

const day = (d: number, h = 12) => new Date(2026, 8, d, h).getTime()

function entry(
  id: number,
  source: ActionSource,
  createdAt: number,
  runId: number | null = null,
  rows = 1
): ActionLogEntry {
  return {
    id,
    createdAt,
    source,
    label: `entry ${id}`,
    undoneAt: null,
    runId,
    changes: Array.from({ length: rows }, (_, i) => ({
      transactionId: id * 100 + i,
      field: 'categoryId' as const,
      before: null,
      after: 1,
      description: 'x',
      accountName: 'a',
      amount: -1000,
      currency: 'USD',
      date: 0
    }))
  }
}

const run = (id: number, createdAt: number): ActionRun => ({
  id,
  createdAt,
  trigger: 'sync',
  label: 'Sync with SimpleFIN'
})

describe('buildFeed', () => {
  const runs = { 7: run(7, day(30, 18)) }
  const entries = [
    entry(5, 'rule', day(30, 18), 7),
    entry(4, 'detector', day(30, 18), 7),
    entry(3, 'user', day(30, 9)),
    entry(2, 'user', day(29))
  ]

  it('folds a run into one item and splits by day', () => {
    const days = buildFeed(entries, runs, true)
    expect(days).toHaveLength(2)
    expect(days[0].items.map((i) => i.kind)).toEqual(['run', 'entry'])
    expect(days[0].items[0].kind === 'run' && days[0].items[0].entries.map((e) => e.id)).toEqual([
      5, 4
    ])
  })

  it('lists every entry when grouping is off', () => {
    const days = buildFeed(entries, runs, false)
    expect(days[0].items.map((i) => i.kind)).toEqual(['entry', 'entry', 'entry'])
  })

  it('renders a one-entry run as a plain row', () => {
    const days = buildFeed([entry(5, 'rule', day(30), 7)], runs, true)
    expect(days[0].items[0].kind).toBe('entry')
  })
})

describe('itemIsNew', () => {
  it('flags only automated items after the last visit', () => {
    const seen = day(30, 10)
    expect(
      itemIsNew(
        { kind: 'entry', entry: entry(1, 'rule', day(30, 11)), createdAt: day(30, 11) },
        seen
      )
    ).toBe(true)
    expect(
      itemIsNew(
        { kind: 'entry', entry: entry(1, 'user', day(30, 11)), createdAt: day(30, 11) },
        seen
      )
    ).toBe(false)
    expect(
      itemIsNew({ kind: 'entry', entry: entry(1, 'rule', day(30, 9)), createdAt: day(30, 9) }, seen)
    ).toBe(false)
    expect(
      itemIsNew(
        { kind: 'entry', entry: entry(1, 'rule', day(30, 11)), createdAt: day(30, 11) },
        null
      )
    ).toBe(false)
  })
})

describe('runSummary', () => {
  it('totals the rules and keeps the other labels', () => {
    const summary = runSummary([
      entry(3, 'rule', 0, 7, 105),
      entry(2, 'rule', 0, 7, 48),
      { ...entry(1, 'detector', 0, 7, 6), label: 'Detected 3 transfers' }
    ])
    expect(summary).toBe('Detected 3 transfers · 2 rules categorized 153 transactions')
  })
})
