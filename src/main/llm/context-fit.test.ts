import { describe, it, expect } from 'vitest'
import type { ChatHistoryItem, ChatModelResponse } from 'node-llama-cpp'
import { currentTurnStart, fitHistory, shiftHistory } from './context-fit'

// a stand-in tokenizer: one token per char of the serialized history
const measure = (history: ChatHistoryItem[]): number => JSON.stringify(history).length

const system: ChatHistoryItem = { type: 'system', text: 'sys' }
const user = (text: string): ChatHistoryItem => ({ type: 'user', text })
const model = (...response: ChatModelResponse['response']): ChatHistoryItem => ({
  type: 'model',
  response
})
const call = (rows: unknown[][]): ChatModelResponse['response'][number] => ({
  type: 'functionCall',
  name: 'query',
  params: { sql: 'SELECT 1' },
  result: { ok: true, columns: ['n'], rows, rowCount: rows.length }
})
const thought = (text: string): ChatModelResponse['response'][number] => ({
  type: 'segment',
  segmentType: 'thought',
  text,
  ended: true
})

describe('fitHistory', () => {
  const history = [system, user('a'.repeat(100)), model('b'.repeat(100)), user('c'), model('d')]
  const cost = (dropped: number): number =>
    measure([system, ...history.slice(1 + dropped), user('next'), { type: 'model', response: [] }])

  it('drops nothing while everything fits', () => {
    expect(fitHistory(history, 'next', measure, cost(0))).toBe(0)
  })

  it('cuts whole turns, never leaving a reply without its question', () => {
    expect(fitHistory(history, 'next', measure, cost(0) - 1)).toBe(2)
  })

  it('drops everything when even one turn does not fit', () => {
    expect(fitHistory(history, 'next', measure, 0)).toBe(4)
  })
})

describe('shiftHistory', () => {
  it('returns the history untouched when it fits', () => {
    const history = [system, user('q'), model('a')]
    expect(shiftHistory(history, measure, Infinity)).toEqual(history)
  })

  it('drops older turns before touching the current one', () => {
    const current = [user('now'), model('partial')]
    const history = [system, user('old'.repeat(50)), model('reply'.repeat(50)), ...current]
    expect(shiftHistory(history, measure, measure([system, ...current]))).toEqual([
      system,
      ...current
    ])
  })

  it('leaves the older items the model still sees countable, for the marker', () => {
    const current = [user('now'), model('partial')]
    const history = [system, user('a'), model('b'), user('old'.repeat(50)), model('c'), ...current]
    const shifted = shiftHistory(
      history,
      measure,
      measure([system, user('a'), model('b'), ...current]) + 5
    )
    expect(currentTurnStart(history) - 1).toBe(4)
    expect(currentTurnStart(shifted) - 1).toBe(0)
  })

  it("expires the rows of this turn's earlier tool results, keeping the newest whole", () => {
    const rows = Array.from({ length: 50 }, (_, i) => [i])
    const history = [system, user('q'), model(call(rows), call(rows), 'answer')]
    const shifted = shiftHistory(history, measure, measure(history) - 1)
    const [first, newest] = (shifted[2] as ChatModelResponse).response as {
      result: Record<string, unknown>
    }[]
    expect(first.result).toMatchObject({ ok: true, rowCount: 50 })
    expect(first.result.rows).toBeUndefined()
    expect(newest.result.rows).toEqual(rows)
  })

  it('drops finished thoughts last, keeping the item being generated', () => {
    const history = [
      system,
      user('q'),
      model(thought('x'.repeat(200)), 'text', thought('still going'))
    ]
    const shifted = shiftHistory(history, measure, measure(history) - 100)
    expect((shifted[2] as ChatModelResponse).response).toEqual(['text', thought('still going')])
  })
})
