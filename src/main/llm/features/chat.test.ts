import { describe, it, expect, vi } from 'vitest'
import {
  sqlFromParamsText,
  type ChartData,
  type ChartSpec,
  type ChatMessage,
  type ChatMessagePart,
  type ChatMessageStatus,
  type ChatRole,
  type QueryToolResult
} from '../../../shared/chat'
import { CHAT_CONTEXT_SIZE } from '../../../shared/llm'
import type { PromptDbContext } from './chat'

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
// the budget buildHistory trims to: 75% of the chat context, 4 chars per
// token, minus the system prompt sharing the context
const BUDGET_CHARS = Math.floor(CHAT_CONTEXT_SIZE * 0.75) * 4 - PROMPT.length

const CTX: PromptDbContext = {
  accounts: [
    { name: 'Chase Checking', currency: 'USD' },
    { name: 'Vanguard', currency: 'USD' }
  ],
  categories: [
    { group: 'Food', names: ['Dining', 'Groceries'] },
    { group: 'Ungrouped', names: ['Misc'] }
  ],
  dateRange: { min: '2023-04', max: '2026-07' }
}

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

  it('replays a chart part as its spec with a bare ok, never the data snapshot', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            callPart('SELECT 42 AS total'),
            { type: 'chart', spec: SPEC, data: DATA, currency: 'USD' },
            { type: 'text', text: 'see the chart' }
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
        { type: 'functionCall', name: 'chart', params: SPEC, result: { ok: true } },
        'see the chart'
      ]
    })
  })

  it('replays preamble text in its generated position, before the call it introduced', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'text', text: 'Let me check.' },
            callPart('SELECT 1'),
            { type: 'text', text: 'Done.' }
          ]
        }
      ],
      PROMPT
    )
    expect(history[2]).toEqual({
      type: 'model',
      response: [
        'Let me check.',
        { type: 'functionCall', name: 'query', params: { sql: 'SELECT 1' }, result: RESULT },
        'Done.'
      ]
    })
  })

  it('replays a failed chart part with its error, never a bare ok', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'chart', spec: SPEC, data: null, currency: null, error: 'no result' },
            { type: 'text', text: 'sorry' }
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
          name: 'chart',
          params: SPEC,
          result: { ok: false, error: 'no result' }
        },
        'sorry'
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

  it('costs a chart part at its replayed size, not its data snapshot', () => {
    // a snapshot bigger than the whole budget must not evict the turn, because
    // only the spec + ok replay
    const huge: ChartData = {
      columns: ['month', 'spending'],
      rows: [['x'.repeat(BUDGET_CHARS), 1]]
    }
    const window = historyWindow(
      [
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'chart', spec: SPEC, data: huge, currency: null },
            { type: 'text', text: 'charted' }
          ]
        },
        row('user', 'next')
      ],
      PROMPT
    )
    expect(window).toEqual({ start: 0, truncated: false })
  })
})

describe('buildSystemPrompt', () => {
  it("interpolates today's date", () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain(new Date().toLocaleDateString('en-CA'))
  })

  it('describes the all-accounts scope when no account is selected', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain("all of the user's accounts")
    expect(prompt).not.toContain('narrowed')
  })

  it('names the account and its narrowing when scoped', () => {
    const prompt = buildSystemPrompt({ accountId: 3, accountName: 'Chase Checking' }, CTX)
    expect(prompt).toContain('narrowed to the account "Chase Checking" (id 3)')
    expect(prompt).toContain("only show that account's data")
  })

  it("quotes back the user's accounts, categories and data span", () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('Accounts: Chase Checking (USD), Vanguard (USD).')
    expect(prompt).toContain('Food: Dining, Groceries; Ungrouped: Misc.')
    expect(prompt).toContain('Transactions span 2023-04 to 2026-07.')
  })

  it('says so when there is no data rather than leaving empty headers', () => {
    const prompt = buildSystemPrompt(
      { accountId: null, accountName: null },
      { accounts: [], categories: [], dateRange: null }
    )
    expect(prompt).toContain('no transaction data yet')
    expect(prompt).not.toContain("The user's data:")
  })

  // the scope views hand the model real amounts (see scopeViewsDdl), so any
  // scaling that creeps back into the prompt is a 1000x error in every figure
  // the recipe produces. Nothing else fails if this regresses.
  it('never asks the model to scale amounts, which the views already did', () => {
    const prompt = buildSystemPrompt({ accountId: 3, accountName: 'Chase Checking' }, CTX)
    expect(prompt).not.toMatch(/1000/)
    expect(prompt).not.toMatch(/milliunit/i)
    expect(prompt).toContain('Money columns are already real amounts')
  })

  it('does not mention invert_balance, which the accounts view applies', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).not.toMatch(/invert/i)
  })

  it('clips a pathologically long category list', () => {
    const names = Array.from({ length: 200 }, (_, i) => `Category number ${i}`)
    const prompt = buildSystemPrompt(
      { accountId: null, accountName: null },
      { ...CTX, categories: [{ group: 'Everything', names }] }
    )
    expect(prompt).toContain('…')
    expect(prompt).not.toContain('Category number 199')
  })

  it('teaches the chart function with literal exemplars', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('calling the chart function')
    expect(prompt).toContain('"type": "line"')
    expect(prompt).toContain('"series": ["spending"]')
    expect(prompt).toContain('most recent query result')
  })
})

describe('assembleAssistantParts', () => {
  it('persists parts in generation order under a leading reasoning part', () => {
    const parts = assembleAssistantParts(
      {
        items: [
          { kind: 'call', call: { name: 'query', args: { sql: 'SELECT 42' }, result: RESULT } },
          { kind: 'text', text: 'the total is 42' }
        ],
        reasoning: 'thinking',
        reasoningMs: 10,
        interrupted: false
      },
      null
    )
    expect(parts).toEqual([
      { type: 'reasoning', text: 'thinking', durationMs: 10 },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 42' }, result: RESULT },
      { type: 'text', text: 'the total is 42' }
    ])
  })

  it('keeps preamble text before the call it introduced', () => {
    const parts = assembleAssistantParts(
      {
        items: [
          { kind: 'text', text: 'Let me check your data.' },
          { kind: 'call', call: { name: 'query', args: { sql: 'SELECT 1' }, result: RESULT } },
          { kind: 'text', text: 'All done.' }
        ],
        reasoning: '',
        reasoningMs: 0,
        interrupted: false
      },
      null
    )
    expect(parts).toEqual([
      { type: 'text', text: 'Let me check your data.' },
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      { type: 'text', text: 'All done.' }
    ])
  })

  it('omits the reasoning part when the model did not think', () => {
    const parts = assembleAssistantParts(
      { items: [{ kind: 'text', text: 'hi' }], reasoning: '', reasoningMs: 0, interrupted: false },
      null
    )
    expect(parts).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('persists a successful chart call as a chart part in call order, stamped with the currency', () => {
    const parts = assembleAssistantParts(
      {
        items: [
          { kind: 'call', call: { name: 'query', args: { sql: 'SELECT 1' }, result: RESULT } },
          { kind: 'call', call: { name: 'chart', args: SPEC, result: { ok: true }, data: DATA } },
          { kind: 'text', text: 'spending is trending down' }
        ],
        reasoning: '',
        reasoningMs: 0,
        interrupted: false
      },
      'USD'
    )
    expect(parts).toEqual([
      { type: 'functionCall', name: 'query', args: { sql: 'SELECT 1' }, result: RESULT },
      { type: 'chart', spec: SPEC, data: DATA, currency: 'USD' },
      { type: 'text', text: 'spending is trending down' }
    ])
  })

  it('persists a failed chart call with its error so the UI can show it', () => {
    const parts = assembleAssistantParts(
      {
        items: [
          {
            kind: 'call',
            call: {
              name: 'chart',
              args: SPEC,
              result: { ok: false, error: 'no result' },
              data: null
            }
          },
          { kind: 'text', text: 'here you go' }
        ],
        reasoning: '',
        reasoningMs: 0,
        interrupted: false
      },
      'USD'
    )
    expect(parts).toEqual([
      { type: 'chart', spec: SPEC, data: null, currency: 'USD', error: 'no result' },
      { type: 'text', text: 'here you go' }
    ])
  })

  it('skips empty text items so a stopped turn leaves no empty bubble', () => {
    expect(
      assembleAssistantParts({ items: [], reasoning: '', reasoningMs: 0, interrupted: true }, null)
    ).toEqual([])
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
