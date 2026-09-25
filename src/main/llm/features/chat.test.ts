import { describe, it, expect, vi } from 'vitest'
import {
  ACTION_TOOL_NAMES,
  ANALYSIS_TOOL_NAMES,
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

const { buildHistory, buildSystemPrompt, historyWindow, lastDataCall, titleFrom } =
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
  dateRange: { min: '2023-04-12', max: '2026-07-15' }
}

const RESULT: QueryToolResult = {
  ok: true,
  columns: ['total'],
  rows: [[42]],
  rowCount: 1,
  truncated: false,
  durationMs: 5
}

// what a successful query result replays as (see replayResult in chat.ts)
const REPLAYED_RESULT = {
  ok: true,
  rowCount: 1,
  note: 'Expired; to reuse or chart this data, run the query again in the current reply.'
}

const SPEC: ChartSpec = {
  type: 'line',
  title: 'Spending by month',
  x: 'month',
  series: ['spending'],
  group: null
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
  return { type: 'functionCall', name: 'query', args: { sql }, result, durationMs: 0 }
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

  it('replays only answer text, never reasoning parts, however many there are', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'reasoning', text: 'let me think about this', durationMs: 1200 },
            { type: 'text', text: 'answer' },
            // a second thought after the answer, e.g. before a follow-up call
            { type: 'reasoning', text: 'one more thing', durationMs: 400 }
          ]
        },
        row('user', 'more'),
        // stopped mid-thought: reasoning parts but no answer — nothing to replay
        {
          role: 'assistant',
          status: 'interrupted',
          parts: [
            { type: 'reasoning', text: 'hmm', durationMs: 300 },
            { type: 'text', text: '' },
            { type: 'reasoning', text: 'still hmm', durationMs: 100 }
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

  it('replays reasoning interleaved between tool calls in its generated position, dropping only the reasoning', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            { type: 'reasoning', text: 'first I should check the data', durationMs: 50 },
            callPart('SELECT 1'),
            { type: 'reasoning', text: 'now I can answer', durationMs: 30 },
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
          params: { sql: 'SELECT 1' },
          result: REPLAYED_RESULT
        },
        'the total is 42'
      ]
    })
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
          result: REPLAYED_RESULT
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
        {
          type: 'functionCall',
          name: 'query',
          params: { sql: 'SELECT 1' },
          result: REPLAYED_RESULT
        }
      ]
    })
  })

  it('replays a chart part as its spec with a bare ok, never the display snapshot', () => {
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [
            callPart('SELECT 42 AS total'),
            {
              type: 'functionCall',
              name: 'chart',
              args: SPEC,
              result: { ok: true },
              display: { data: DATA, currency: 'USD', series: ['spending'] },
              durationMs: 0
            },
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
          result: REPLAYED_RESULT
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
        {
          type: 'functionCall',
          name: 'query',
          params: { sql: 'SELECT 1' },
          result: REPLAYED_RESULT
        },
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
            {
              type: 'functionCall',
              name: 'chart',
              args: SPEC,
              result: { ok: false, error: 'no result' },
              display: null,
              durationMs: 0
            },
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

  it('replays a failed query result unchanged, keeping its error for the model', () => {
    const failed: QueryToolResult = { ok: false, error: 'no such column: x', durationMs: 2 }
    const history = buildHistory(
      [
        row('user', 'hi'),
        {
          role: 'assistant',
          status: 'complete',
          parts: [callPart('SELECT x', failed), { type: 'text', text: 'that failed' }]
        }
      ],
      PROMPT
    )
    expect(history[2]).toEqual({
      type: 'model',
      response: [
        { type: 'functionCall', name: 'query', params: { sql: 'SELECT x' }, result: failed },
        'that failed'
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

  it('costs a chart part at its replayed size, not its display snapshot', () => {
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
            {
              type: 'functionCall',
              name: 'chart',
              args: SPEC,
              result: { ok: true },
              display: { data: huge, currency: null, series: ['spending'] },
              durationMs: 0
            },
            { type: 'text', text: 'charted' }
          ]
        },
        row('user', 'next')
      ],
      PROMPT
    )
    expect(window).toEqual({ start: 0, truncated: false })
  })

  it('costs a query part at its replayed size, so huge result rows cannot evict the turn', () => {
    const huge: QueryToolResult = {
      ok: true,
      columns: ['blob'],
      rows: [['x'.repeat(BUDGET_CHARS)]],
      rowCount: 1,
      truncated: false,
      durationMs: 5
    }
    const window = historyWindow(
      [
        {
          role: 'assistant',
          status: 'complete',
          parts: [callPart('SELECT 1', huge), { type: 'text', text: 'big' }]
        },
        row('user', 'next')
      ],
      PROMPT
    )
    expect(window).toEqual({ start: 0, truncated: false })
  })
})

describe('buildSystemPrompt', () => {
  const ALL = { accountId: null, accountName: null }

  it("interpolates today's date", () => {
    expect(buildSystemPrompt(ALL, CTX)).toContain(new Date().toLocaleDateString('en-CA'))
  })

  it('describes the all-accounts scope when no account is selected', () => {
    const prompt = buildSystemPrompt(ALL, CTX)
    expect(prompt).toContain("all of the user's accounts")
    expect(prompt).not.toContain('narrowed')
  })

  it('names the account and its narrowing when scoped', () => {
    const prompt = buildSystemPrompt({ accountId: 3, accountName: 'Chase Checking' }, CTX)
    expect(prompt).toContain('narrowed to the account "Chase Checking"')
    expect(prompt).toContain("only shows that account's data")
  })

  it("quotes back the user's accounts and data span", () => {
    const prompt = buildSystemPrompt(ALL, CTX)
    expect(prompt).toContain('Accounts: Chase Checking (USD), Vanguard (USD).')
    expect(prompt).toContain('Transactions span 2023-04-12 to 2026-07-15.')
  })

  it('says so when there is no data rather than leaving empty headers', () => {
    const prompt = buildSystemPrompt(ALL, { accounts: [], categories: [], dateRange: null })
    expect(prompt).toContain('no transaction data yet')
  })

  // the scope views hand the model real amounts (see scopeViewsDdl), so any
  // scaling that creeps back into the prompt is a 1000x error in every figure
  it('never asks the model to scale amounts, which the views already did', () => {
    const prompt = buildSystemPrompt({ accountId: 3, accountName: 'Chase Checking' }, CTX)
    expect(prompt).not.toMatch(/1000/)
    expect(prompt).not.toMatch(/milliunit/i)
    expect(prompt).toContain('never scale them')
  })

  it('routes every tool the worker registers', () => {
    const prompt = buildSystemPrompt(ALL, CTX)
    for (const name of [...ANALYSIS_TOOL_NAMES, ...ACTION_TOOL_NAMES, 'query', 'calc'])
      expect(prompt).toContain(name)
    // the action tools only ever propose, and never answer a question
    expect(prompt).toContain('Never call them to answer a question')
  })

  // periods are resolved in code; a model left to work out a window picks the
  // wrong month, and counted the month in progress as a complete one
  it('hands period meaning to the tools instead of teaching date math', () => {
    const prompt = buildSystemPrompt(ALL, CTX)
    expect(prompt).toContain('last_3_months is the three complete months')
    expect(prompt).toContain('never work out dates yourself')
    expect(prompt).not.toContain('resolve_dates')
  })

  // every worked turn ends on an answer quoting a figure that visibly sits in
  // the facts printed right above it, so the copy path the model learns is
  // "read it off the result"
  it('sources every figure from a result, never mental arithmetic', () => {
    const prompt = buildSystemPrompt(ALL, CTX)
    expect(prompt).toContain('I answer:')
    expect(prompt).toContain('never from your own arithmetic')
    expect(prompt).toContain('A guessed insight is worse than none')
  })

  // REGRESSION: an earlier draft printed a chart spec as a transcript line and
  // the model wrote it into its answer as text, with no chart drawn
  it('never shows a tool call as an emittable line', () => {
    const lines = buildSystemPrompt(ALL, CTX)
      .split('\n')
      .map((line) => line.trim())
    const toolNames = [...ANALYSIS_TOOL_NAMES, ...ACTION_TOOL_NAMES, 'query', 'chart', 'calc']
    const emittable = lines.filter((line) =>
      toolNames.some((name) => line.startsWith(`${name} {`) || line.startsWith(`${name}(`))
    )
    expect(emittable).toEqual([])
    expect(lines.filter((line) => line.startsWith('{'))).toEqual([])
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

describe('typed tool replay and follow-up seed', () => {
  const totalsArgs = { measure: 'spending', by: 'month', period: 'last_12_months', chart: 'auto' }
  const totalsPart: ChatMessagePart = {
    type: 'functionCall',
    name: 'totals',
    args: totalsArgs,
    result: {
      ok: true,
      period: '2025-09 to 2026-08',
      facts: { total_spending: 120 },
      columns: ['month', 'spending'],
      rows: [['2026-06', 12.5]],
      rowCount: 1,
      durationMs: 3
    },
    durationMs: 0
  }
  const autoChart: ChatMessagePart = {
    type: 'functionCall',
    name: 'chart',
    args: SPEC,
    result: { ok: true },
    display: { data: DATA, currency: 'USD', series: ['spending'] },
    durationMs: 0
  }
  const reply = (parts: ChatMessagePart[]): Pick<ChatMessage, 'role' | 'status' | 'parts'> => ({
    role: 'assistant',
    status: 'complete',
    parts
  })

  it('replays a typed result as its facts, never its rows', () => {
    const history = buildHistory([row('user', 'q'), reply([totalsPart])], PROMPT)
    const model = history[2] as { response: { result: unknown }[] }
    expect(model.response[0].result).toEqual({
      ok: true,
      period: '2025-09 to 2026-08',
      facts: { total_spending: 120 },
      rows: 1
    })
  })

  // replayed, a chart the loop drew reads as the model calling chart right
  // after a typed tool, which the chart tool's description forbids
  it('never replays the chart the loop drew for a typed tool', () => {
    const history = buildHistory(
      [row('user', 'q'), reply([totalsPart, autoChart, { type: 'text', text: 'done' }])],
      PROMPT
    )
    const model = history[2] as { response: unknown[] }
    expect(model.response).toHaveLength(2)
  })

  it('seeds the next turn with the newest data call and the chart drawn from it', () => {
    const rows = [row('user', 'q'), reply([totalsPart, autoChart]), row('user', 'as a pie')]
    expect(lastDataCall(rows)).toEqual({ name: 'totals', args: totalsArgs, chart: SPEC })
    expect(lastDataCall([row('user', 'hi')])).toBeNull()
  })
})
