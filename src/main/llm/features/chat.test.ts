import { describe, it, expect, vi } from 'vitest'
import {
  type ChartData,
  type ChartSpec,
  type ChatMessage,
  type ChatMessagePart,
  type ChatMessageStatus,
  type ChatRole,
  type QueryToolResult
} from '../../../shared/chat'
import { CHAT_CONTEXT_SIZE } from '../../../shared/llm'
import { MAX_CHART_SERIES } from '../chart-tool'
import type { PromptDbContext } from './chat'

// chat.ts reaches Electron through these modules (better-sqlite3 won't load
// under vitest's ABI either); stub them so the pure helpers stay testable
vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../manager', () => ({ llmManager: {}, sendToRenderer: vi.fn() }))
vi.mock('../queue', () => ({ enqueueGenerate: vi.fn() }))

const { buildHistory, buildSystemPrompt, historyWindow, titleFrom } = await import('./chat')

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
    expect(prompt).toContain('Money columns hold real amounts')
  })

  it('never asks the model to convert epochs, which the views already did', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).not.toMatch(/unixepoch/i)
    expect(prompt).toContain("txn_date is 'YYYY-MM-DD'")
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

  it('documents the pending exclusion and the tables the model can reach', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('pending = 0')
    expect(prompt).toContain('action_log')
    // the cross-currency rule renders only for mixed-currency users; that
    // conditional lives in prompt-sql.test.ts, which runs the recipe it adds
  })

  it('teaches the chart function with literal exemplars', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('calling the chart function')
    expect(prompt).toContain('"type": "line"')
    expect(prompt).toContain('"series": ["spending"]')
    expect(prompt).toContain('most recent query result')
    // the group pivot is declared, never guessed; the exemplar teaches it
    expect(prompt).toContain('"group": "category_group"')
    expect(prompt).toContain('"group": null')
  })

  // The output rules are keyed on the shape of the result the model can see
  // (how many rows, which columns), never on classifying the question, which
  // this model is far worse at. Each branch of that table has to survive
  // editing, or the model falls back to prose plus a table.
  it('picks the output from the result shape, with every branch stated', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('SHAPE of the result you received')
    // the branches deliberately overlap (two rows WITH a group column matches
    // both the two-row line and a chart line), so first-match is the tiebreaker
    // and has to survive: without it the model has no rule for the overlap
    expect(prompt).toContain('take the FIRST matching line')
    expect(prompt).toContain(
      'Three or more rows, an x column and one or more measures: chart it, every measure in series'
    )
    expect(prompt).toContain('Exactly two rows')
    expect(prompt).toContain('Markdown table, never a chart')
    // REGRESSION: the model charted `bar` with x = month while this rule was a
    // trailing clause on two bullets. It only holds as its own sentence.
    expect(prompt).toContain('spending by month is a line, never a bar')
    // REGRESSION: it printed the four charted rows as a table and then charted
    // them, with the old prohibition sitting in the section's last line
    expect(prompt).toContain('A chart REPLACES the rows it draws')
    // a comparison is taught as a whole worked turn rather than as wording to
    // classify, since this model matches shapes far better than intents
    expect(prompt).toContain('did I spend more in July than June?')
  })

  // Both claims are about the chart tool's real behavior, so a prompt that
  // drifts from chart-tool.ts teaches the model calls that fail (group) or,
  // worse, a chart that silently omits rows (pie over a signed measure).
  it('states the chart tool limits it actually enforces', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('group works on line and bar only')
    expect(prompt).toContain('never over net')
    // the series cap is interpolated, so it can never drift from the tool
    expect(prompt).toContain(`more than ${MAX_CHART_SERIES} distinct values`)
    expect(MAX_CHART_SERIES).toBeGreaterThan(0)
  })

  // every worked turn ends on an answer sentence quoting a figure that is
  // visibly sitting in the rows printed right above it, so the copy path the
  // model learns is "read it off the row" rather than "chart it and move on"
  it('puts the number in the answer, not only in the chart', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('I answer:')
    expect(prompt).toContain('state the figure in a sentence AND chart it as stat')
  })

  // REGRESSION: told to lead with a number after charting a per-day result
  // that contained no total, the model stated two invented totals as fact.
  // Leading with a figure is only safe while the figure has to come from a
  // row it received, so the escape hatch (query the total) rides with it.
  it('sources the leading number from a row, never from mental arithmetic', () => {
    const prompt = buildSystemPrompt({ accountId: null, accountName: null }, CTX)
    expect(prompt).toContain('must sit in a row a query actually returned to you')
    expect(prompt).toContain('carries no total of its own')
    expect(prompt).toContain('I query the total')
    // and the example figures are labelled fictional, so they are never quoted
    // back at the user as if they were this user's data
    expect(prompt).toContain('are INVENTED to show the shape')
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
