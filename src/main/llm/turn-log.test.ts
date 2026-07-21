import { describe, it, expect } from 'vitest'
import type { ChartData, ChartSpec, QueryToolResult, StreamingChatPart } from '../../shared/chat'
import { createTurnLog } from './turn-log'

const RESULT: QueryToolResult = {
  ok: true,
  columns: ['total'],
  rows: [[42]],
  rowCount: 1,
  truncated: false,
  durationMs: 5
}

// the open-to-settle wall-clock the worker measures and hands to settleCall; the
// log just carries it onto the part (5 above is the query's own DB time, a
// different number, so keeping them distinct proves the log doesn't conflate them)
const CALL_MS = 34

const SPEC: ChartSpec = {
  type: 'line',
  title: 'Spending by month',
  x: 'month',
  series: ['spending'],
  group: null
}
const DATA: ChartData = { columns: ['month', 'spending'], rows: [['2026-06', 12.5]] }

describe('createTurnLog', () => {
  it('persists a leading reasoning segment as a reasoning part ahead of the rest', () => {
    const turn = createTurnLog()
    turn.reasoningChunk('thinking')
    turn.closeReasoning(10)
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 42' }, result: RESULT }, CALL_MS)
    turn.pushText('the total is 42')
    expect(turn.finish('the total is 42', false)).toEqual({
      parts: [
        { type: 'reasoning', text: 'thinking', durationMs: 10 },
        {
          type: 'functionCall',
          name: 'query',
          args: { sql: 'SELECT 42' },
          result: RESULT,
          durationMs: CALL_MS
        },
        { type: 'text', text: 'the total is 42' }
      ],
      interrupted: false
    })
  })

  it('keeps preamble text before the call it introduced, merging consecutive chunks', () => {
    const turn = createTurnLog()
    turn.pushText('Let me check')
    turn.pushText(' your data.')
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    turn.pushText('All done.')
    expect(turn.finish('Let me check your data.All done.', false).parts).toEqual([
      { type: 'text', text: 'Let me check your data.' },
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 1' },
        result: RESULT,
        durationMs: CALL_MS
      },
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
    turn.reasoningChunk('I should ')
    turn.reasoningChunk('check the data')
    turn.closeReasoning(20)
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    turn.reasoningChunk('now I can answer')
    turn.closeReasoning(15)
    turn.pushText('the total is 1')
    expect(turn.finish('the total is 1', false).parts).toEqual([
      { type: 'reasoning', text: 'I should check the data', durationMs: 20 },
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 1' },
        result: RESULT,
        durationMs: CALL_MS
      },
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
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    turn.settleCall(
      {
        name: 'chart',
        args: SPEC,
        result: { ok: true },
        display: { data: DATA, currency: 'USD', series: ['spending'] }
      },
      CALL_MS
    )
    turn.pushText('spending is trending down')
    expect(turn.finish('spending is trending down', false).parts).toEqual([
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 1' },
        result: RESULT,
        durationMs: CALL_MS
      },
      {
        type: 'functionCall',
        name: 'chart',
        args: SPEC,
        result: { ok: true },
        display: { data: DATA, currency: 'USD', series: ['spending'] },
        durationMs: CALL_MS
      },
      { type: 'text', text: 'spending is trending down' }
    ])
  })

  it('persists a failed chart call with its error and null display', () => {
    const turn = createTurnLog()
    turn.settleCall(
      {
        name: 'chart',
        args: SPEC,
        result: { ok: false, error: 'no result' },
        display: null
      },
      CALL_MS
    )
    turn.pushText('here you go')
    expect(turn.finish('here you go', false).parts).toEqual([
      {
        type: 'functionCall',
        name: 'chart',
        args: SPEC,
        result: { ok: false, error: 'no result' },
        display: null,
        durationMs: CALL_MS
      },
      { type: 'text', text: 'here you go' }
    ])
  })

  it('never opens a part for whitespace-only glue between calls', () => {
    const turn = createTurnLog()
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    turn.pushText('\n')
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 2' }, result: RESULT }, CALL_MS)
    expect(turn.finish('\n', false).parts).toEqual([
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 1' },
        result: RESULT,
        durationMs: CALL_MS
      },
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 2' },
        result: RESULT,
        durationMs: CALL_MS
      }
    ])
  })

  it('folds buffered leading whitespace into the text part real text opens', () => {
    const turn = createTurnLog()
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    turn.pushText('\n')
    turn.pushText('Done.')
    expect(turn.finish('\nDone.', false).parts).toEqual([
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 1' },
        result: RESULT,
        durationMs: CALL_MS
      },
      { type: 'text', text: '\nDone.' }
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
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    expect(turn.finish('Checking.Done.', false).parts).toEqual([
      { type: 'text', text: 'Checking.' },
      {
        type: 'functionCall',
        name: 'query',
        args: { sql: 'SELECT 1' },
        result: RESULT,
        durationMs: CALL_MS
      },
      { type: 'text', text: 'Done.' }
    ])
  })

  it('appends nothing when fullText is not a prefix extension of the streamed text', () => {
    const turn = createTurnLog()
    turn.pushText('hello')
    expect(turn.finish('different', false).parts).toEqual([{ type: 'text', text: 'hello' }])
  })
})

describe('createTurnLog: part patches', () => {
  function record(): { patches: [number, StreamingChatPart][]; onPart: typeof push } {
    const patches: [number, StreamingChatPart][] = []
    const push = (index: number, part: StreamingChatPart): void => {
      // snapshot: the log mutates parts in place, and the wire serializes
      patches.push([index, structuredClone(part)])
    }
    return { patches, onPart: push }
  }

  it('patches the same index as a part grows, and the next as a new one opens', () => {
    const { patches, onPart } = record()
    const turn = createTurnLog(onPart)
    turn.pushText('Hel')
    turn.pushText('lo.')
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    expect(patches).toEqual([
      [0, { type: 'text', text: 'Hel' }],
      [0, { type: 'text', text: 'Hello.' }],
      [
        1,
        {
          type: 'functionCall',
          name: 'query',
          args: { sql: 'SELECT 1' },
          result: RESULT,
          durationMs: CALL_MS
        }
      ]
    ])
  })

  it('opens a pending call the settle then replaces at the same index', () => {
    const { patches, onPart } = record()
    const turn = createTurnLog(onPart)
    turn.openCall('query')
    turn.settleCall({ name: 'query', args: { sql: 'SELECT 1' }, result: RESULT }, CALL_MS)
    expect(patches).toEqual([
      [0, { type: 'functionCall', name: 'query' }],
      [
        0,
        {
          type: 'functionCall',
          name: 'query',
          args: { sql: 'SELECT 1' },
          result: RESULT,
          durationMs: CALL_MS
        }
      ]
    ])
  })

  it('streams a thought as a pending reasoning part, then stamps its duration', () => {
    const { patches, onPart } = record()
    const turn = createTurnLog(onPart)
    turn.reasoningChunk('hm')
    turn.reasoningChunk('m')
    turn.closeReasoning(12)
    expect(patches).toEqual([
      [0, { type: 'reasoning', text: 'hm', durationMs: null }],
      [0, { type: 'reasoning', text: 'hmm', durationMs: null }],
      [0, { type: 'reasoning', text: 'hmm', durationMs: 12 }]
    ])
  })

  it('drops a call still pending at finish (aborted mid-params)', () => {
    const turn = createTurnLog()
    turn.pushText('Checking.')
    turn.openCall('query')
    expect(turn.finish('Checking.', true)).toEqual({
      parts: [{ type: 'text', text: 'Checking.' }],
      interrupted: true
    })
  })
})
