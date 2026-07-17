import { describe, it, expect, vi } from 'vitest'
import {
  sqlFromParamsText,
  type ChatMessage,
  type ChatMessagePart,
  type ChatMessageStatus,
  type ChatRole,
  type QueryToolResult
} from '../../../shared/chat'

// chat.ts reaches Electron through these modules (better-sqlite3 won't load
// under vitest's ABI either); stub them so the pure helpers stay testable
vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../manager', () => ({ llmManager: {}, sendToRenderer: vi.fn() }))
vi.mock('../queue', () => ({ enqueueGenerate: vi.fn() }))

const { assembleAssistantParts, buildHistory, buildSystemPrompt, historyWindow, titleFrom } =
  await import('./chat')

const PROMPT = 'test system prompt'
// the budget buildHistory trims to: 75% of the 8192 chat context, 4 chars per
// token, minus the system prompt sharing the context
const BUDGET_CHARS = Math.floor(8192 * 0.75) * 4 - PROMPT.length

const RESULT: QueryToolResult = {
  ok: true,
  columns: ['total'],
  rows: [[42]],
  rowCount: 1,
  truncated: false,
  durationMs: 5
}

function row(
  role: ChatRole,
  text: string,
  status: ChatMessageStatus = 'complete'
): Pick<ChatMessage, 'role' | 'status' | 'parts'> {
  return { role, status, parts: [{ type: 'text', text }] }
}

function callPart(sql: string, result: QueryToolResult = RESULT): ChatMessagePart {
  return { type: 'functionCall', name: 'query', args: { sql }, result }
}

describe('buildHistory', () => {
  it('maps rows in order under the supplied system prompt', () => {
    const history = buildHistory(
      [row('user', 'hi'), row('assistant', 'hello'), row('user', 'bye')],
      PROMPT
    )
    expect(history).toEqual([
      { type: 'system', text: PROMPT },
      { type: 'user', text: 'hi' },
      { type: 'model', response: ['hello'] },
      { type: 'user', text: 'bye' }
    ])
  })

  it('skips error rows but keeps interrupted partials', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        row('assistant', '', 'error'),
        row('user', 'again'),
        row('assistant', 'partial ans', 'interrupted')
      ],
      PROMPT
    )
    expect(history).toEqual([
      { type: 'system', text: PROMPT },
      { type: 'user', text: 'hi' },
      { type: 'user', text: 'again' },
      { type: 'model', response: ['partial ans'] }
    ])
  })

  it('skips rows with no content (e.g. a reply stopped before the first token)', () => {
    const history = buildHistory([row('user', 'hi'), row('assistant', '', 'interrupted')], PROMPT)
    expect(history).toEqual([
      { type: 'system', text: PROMPT },
      { type: 'user', text: 'hi' }
    ])
  })

  it('replays only answer text, never reasoning parts', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'reasoning', text: 'let me think about this', durationMs: 1200 },
            { type: 'text', text: 'answer' }
          ]
        },
        row('user', 'more'),
        // stopped mid-thought: a reasoning part but no answer — nothing to replay
        {
          role: 'assistant',
          status: 'interrupted',
          parts: [
            { type: 'reasoning', text: 'hmm', durationMs: 300 },
            { type: 'text', text: '' }
          ]
        }
      ],
      PROMPT
    )
    expect(history).toEqual([
      { type: 'system', text: PROMPT },
      { type: 'user', text: 'hi' },
      { type: 'model', response: ['answer'] },
      { type: 'user', text: 'more' }
    ])
  })

  it('replays query calls as native functionCall entries ahead of the text', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'reasoning', text: 'thinking', durationMs: 10 },
            callPart('SELECT 42 AS total'),
            { type: 'text', text: 'the total is 42' }
          ]
        }
      ],
      PROMPT
    )
    expect(history[2]).toEqual({
      type: 'model',
      response: [
        {
          type: 'functionCall',
          name: 'query',
          params: { sql: 'SELECT 42 AS total' },
          result: RESULT
        },
        'the total is 42'
      ]
    })
  })

  it('keeps a turn that queried but was stopped before any answer text', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'interrupted',
          parts: [callPart('SELECT 1'), { type: 'text', text: '' }]
        }
      ],
      PROMPT
    )
    expect(history[2]).toEqual({
      type: 'model',
      response: [
        { type: 'functionCall', name: 'query', params: { sql: 'SELECT 1' }, result: RESULT }
      ]
    })
  })

  it('counts query calls against the char budget', () => {
    const history = buildHistory(
      [
        {
          role: 'assistant',
          status: 'complete',
          parts: [callPart('x'.repeat(BUDGET_CHARS)), { type: 'text', text: 'old' }]
        },
        row('user', 'newest')
      ],
      PROMPT
    )
    expect(history).toEqual([
      { type: 'system', text: PROMPT },
      { type: 'user', text: 'newest' }
    ])
  })

  it('drops the oldest turns once the char budget is exceeded', () => {
    const third = Math.ceil(BUDGET_CHARS / 3) + 1 // three rows can't all fit
    const history = buildHistory(
      [
        row('user', 'a'.repeat(third)),
        row('assistant', 'b'.repeat(third)),
        row('user', 'c'.repeat(third))
      ],
      PROMPT
    )
    expect(history).toHaveLength(3) // system + newest two
    expect(history[1]).toEqual({ type: 'model', response: ['b'.repeat(third)] })
    expect(history[2]).toEqual({ type: 'user', text: 'c'.repeat(third) })
  })

  it('stops at the first over-budget row so kept history has no gaps', () => {
    const history = buildHistory(
      [
        row('user', 'tiny'), // would fit, but sits behind the over-budget row
        row('assistant', 'x'.repeat(BUDGET_CHARS)),
        row('user', 'newest')
      ],
      PROMPT
    )
    expect(history).toEqual([
      { type: 'system', text: PROMPT },
      { type: 'user', text: 'newest' }
    ])
  })
})

describe('historyWindow', () => {
  it('reports no truncation while the whole conversation fits', () => {
    expect(historyWindow([row('user', 'hi'), row('assistant', 'hello')], PROMPT)).toEqual({
      start: 0,
      truncated: false
    })
  })

  it('points at the oldest kept row once the budget drops older ones', () => {
    const third = Math.ceil(BUDGET_CHARS / 3) + 1
    const window = historyWindow(
      [
        row('user', 'a'.repeat(third)),
        row('assistant', 'b'.repeat(third)),
        row('user', 'c'.repeat(third))
      ],
      PROMPT
    )
    expect(window).toEqual({ start: 1, truncated: true })
  })

  it('does not call skipped unreplayable rows truncation', () => {
    const window = historyWindow([row('assistant', '', 'error'), row('user', 'hi')], PROMPT)
    expect(window).toEqual({ start: 1, truncated: false })
  })
})

describe('buildSystemPrompt', () => {
  it("interpolates today's date", () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null })
    expect(prompt).toContain(new Date().toLocaleDateString('en-CA'))
  })

  it('describes the all-accounts scope when no account is selected', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null })
    expect(prompt).toContain("all of the user's accounts")
    expect(prompt).not.toContain('narrowed')
  })

  it('names the account and its narrowing when scoped', () => {
    const prompt = buildSystemPrompt({ accountId: 3, accountName: 'Chase Checking' })
    expect(prompt).toContain('narrowed to the account "Chase Checking" (id 3)')
    expect(prompt).toContain("only show that account's data")
  })
})

describe('assembleAssistantParts', () => {
  it('orders parts reasoning → calls → text, mirroring generation', () => {
    const parts = assembleAssistantParts({
      text: 'the total is 42',
      reasoning: 'thinking',
      reasoningMs: 10,
      interrupted: false,
      functionCalls: [{ name: 'query', args: { sql: 'SELECT 42' }, result: RESULT }]
    })
    expect(parts).toEqual([
      { type: 'reasoning', text: 'thinking', durationMs: 10 },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 42' }, result: RESULT },
      { type: 'text', text: 'the total is 42' }
    ])
  })

  it('omits the reasoning part when the model did not think', () => {
    const parts = assembleAssistantParts({
      text: 'hi',
      reasoning: '',
      reasoningMs: 0,
      interrupted: false,
      functionCalls: []
    })
    expect(parts).toEqual([{ type: 'text', text: 'hi' }])
  })
})

describe('sqlFromParamsText', () => {
  it('extracts the sql value from a partial params stream', () => {
    expect(sqlFromParamsText('{"sql": "SELECT * FROM tra')).toBe('SELECT * FROM tra')
  })

  it('drops the closing quote and brace once complete', () => {
    expect(sqlFromParamsText('{"sql": "SELECT 1"}')).toBe('SELECT 1')
  })

  it('unescapes JSON string escapes', () => {
    expect(sqlFromParamsText('{"sql": "SELECT \\"a\\"\\nFROM t"}')).toBe('SELECT "a"\nFROM t')
  })

  it('drops a dangling backslash mid-escape', () => {
    expect(sqlFromParamsText('{"sql": "a\\')).toBe('a')
  })

  it('returns empty until the sql key opens', () => {
    expect(sqlFromParamsText('')).toBe('')
    expect(sqlFromParamsText('{"s')).toBe('')
  })
})

describe('titleFrom', () => {
  it('uses the first line, trimmed', () => {
    expect(titleFrom('  Budget question  \nmore detail')).toBe('Budget question')
  })

  it('clips long titles to 60 characters with an ellipsis', () => {
    const title = titleFrom('x'.repeat(80))
    expect(title).toBe('x'.repeat(57) + '…')
    expect(title.length).toBe(58)
  })
})
