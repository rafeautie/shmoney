import { describe, it, expect } from 'vitest'
import type { ChartData, ChartSpec, QueryToolResult } from '../../shared/chat'
import { createTurnLog } from './turn-log'

const RESULT: QueryToolResult = {
  ok: true,
  columns: ['total'],
  rows: [[42]],
  rowCount: 1,
  truncated: false,
  durationMs: 5
}

const SPEC: ChartSpec = {
  type: 'line',
  title: 'Spending by month',
  x: 'month',
  series: ['spending']
}
const DATA: ChartData = { columns: ['month', 'spending'], rows: [['2026-06', 12.5]] }

describe('createTurnLog', () => {
  it('persists a leading reasoning segment as a reasoning part ahead of the rest', () => {
    const turn = createTurnLog()
    turn.pushReasoning('thinking', 10)
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 42' }, result: RESULT })
    turn.pushText('the total is 42')
    expect(turn.finish('the total is 42', false)).toEqual({
      parts: [
        { type: 'reasoning', text: 'thinking', durationMs: 10 },
        { type: 'functionCall', name: 'query', args: { sql: 'SELECT 42' }, result: RESULT },
        { type: 'text', text: 'the total is 42' }
      ],
      interrupted: false
    })
  })

  it('keeps preamble text before the call it introduced, merging consecutive chunks', () => {
    const turn = createTurnLog()
    turn.pushText('Let me check')
    turn.pushText(' your data.')
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT })
    turn.pushText('All done.')
    expect(turn.finish('Let me check your data.All done.', false).parts).toEqual([
      { type: 'text', text: 'Let me check your data.' },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      { type: 'text', text: 'All done.' }
    ])
  })

  it('produces no reasoning part when the model did not think', () => {
    const turn = createTurnLog()
    turn.pushText('hi')
    expect(turn.finish('hi', false).parts).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('keeps reasoning interleaved between calls in its generated position', () => {
    const turn = createTurnLog()
    turn.pushReasoning('I should check the data', 20)
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT })
    turn.pushReasoning('now I can answer', 15)
    turn.pushText('the total is 1')
    expect(turn.finish('the total is 1', false).parts).toEqual([
      { type: 'reasoning', text: 'I should check the data', durationMs: 20 },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      { type: 'reasoning', text: 'now I can answer', durationMs: 15 },
      { type: 'text', text: 'the total is 1' }
    ])
  })

  // the currency in a chart's display is stamped by the worker's chart handler
  // when it builds the call (from the turn command's currency), not here;
  // vitest can't load the worker (better-sqlite3/node-llama-cpp ABI), so the
  // log only has to carry the call through unchanged
  it('carries a successful chart call through with its display payload', () => {
    const turn = createTurnLog()
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT })
    turn.pushCall({
      name: 'chart',
      args: SPEC,
      result: { ok: true },
      display: { data: DATA, currency: 'USD' }
    })
    turn.pushText('spending is trending down')
    expect(turn.finish('spending is trending down', false).parts).toEqual([
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      {
        type: 'functionCall',
        name: 'chart',
        args: SPEC,
        result: { ok: true },
        display: { data: DATA, currency: 'USD' }
      },
      { type: 'text', text: 'spending is trending down' }
    ])
  })

  it('persists a failed chart call with its error and null display', () => {
    const turn = createTurnLog()
    turn.pushCall({
      name: 'chart',
      args: SPEC,
      result: { ok: false, error: 'no result' },
      display: null
    })
    turn.pushText('here you go')
    expect(turn.finish('here you go', false).parts).toEqual([
      {
        type: 'functionCall',
        name: 'chart',
        args: SPEC,
        result: { ok: false, error: 'no result' },
        display: null
      },
      { type: 'text', text: 'here you go' }
    ])
  })

  it('drops whitespace-only text between calls so no empty bubble persists', () => {
    const turn = createTurnLog()
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT })
    turn.pushText('\n')
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 2' }, result: RESULT })
    expect(turn.finish('\n', false).parts).toEqual([
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 2' }, result: RESULT }
    ])
  })

  it('finishes an empty stopped turn with no parts', () => {
    expect(createTurnLog().finish('', true)).toEqual({ parts: [], interrupted: true })
  })

  it('appends the un-streamed tail when fullText extends the streamed text', () => {
    const turn = createTurnLog()
    turn.pushText('the total')
    expect(turn.finish('the total is 42', false).parts).toEqual([
      { type: 'text', text: 'the total is 42' }
    ])
  })

  it('appends the tail as its own part when a call closed the trailing text', () => {
    const turn = createTurnLog()
    turn.pushText('Checking.')
    turn.pushCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT })
    expect(turn.finish('Checking.Done.', false).parts).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      { type: 'text', text: 'Done.' }
    ])
  })

  it('appends nothing when fullText is not a prefix extension of the streamed text', () => {
    const turn = createTurnLog()
    turn.pushText('hello')
    expect(turn.finish('different', false).parts).toEqual([{ type: 'text', text: 'hello' }])
  })
})
