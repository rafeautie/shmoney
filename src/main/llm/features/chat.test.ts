import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, ChatMessageStatus, ChatRole } from '../../../shared/chat'

// chat.ts reaches Electron through these modules (better-sqlite3 won't load
// under vitest's ABI either); stub them so the pure helpers stay testable
vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../manager', () => ({ llmManager: {}, sendToRenderer: vi.fn() }))
vi.mock('../queue', () => ({ enqueueGenerate: vi.fn() }))

const { buildHistory, SYSTEM_PROMPT, titleFrom } = await import('./chat')

// the budget buildHistory trims to: 75% of the 8192 chat context, 4 chars/token
const BUDGET_CHARS = Math.floor(8192 * 0.75) * 4

function row(
  role: ChatRole,
  text: string,
  status: ChatMessageStatus = 'complete'
): Pick<ChatMessage, 'role' | 'status' | 'parts'> {
  return { role, status, parts: [{ type: 'text', text }] }
}

describe('buildHistory', () => {
  it('maps rows in order under a leading system prompt', () => {
    const history = buildHistory([row('user', 'hi'), row('assistant', 'hello'), row('user', 'bye')])
    expect(history).toEqual([
      { type: 'system', text: SYSTEM_PROMPT },
      { type: 'user', text: 'hi' },
      { type: 'model', response: ['hello'] },
      { type: 'user', text: 'bye' }
    ])
  })

  it('skips error rows but keeps interrupted partials', () => {
    const history = buildHistory([
      row('user', 'hi'),
      row('assistant', '', 'error'),
      row('user', 'again'),
      row('assistant', 'partial ans', 'interrupted')
    ])
    expect(history).toEqual([
      { type: 'system', text: SYSTEM_PROMPT },
      { type: 'user', text: 'hi' },
      { type: 'user', text: 'again' },
      { type: 'model', response: ['partial ans'] }
    ])
  })

  it('skips rows with no text (e.g. a reply stopped before the first token)', () => {
    const history = buildHistory([row('user', 'hi'), row('assistant', '', 'interrupted')])
    expect(history).toEqual([
      { type: 'system', text: SYSTEM_PROMPT },
      { type: 'user', text: 'hi' }
    ])
  })

  it('drops the oldest turns once the char budget is exceeded', () => {
    const third = Math.ceil(BUDGET_CHARS / 3) + 1 // three rows can't all fit
    const history = buildHistory([
      row('user', 'a'.repeat(third)),
      row('assistant', 'b'.repeat(third)),
      row('user', 'c'.repeat(third))
    ])
    expect(history).toHaveLength(3) // system + newest two
    expect(history[1]).toEqual({ type: 'model', response: ['b'.repeat(third)] })
    expect(history[2]).toEqual({ type: 'user', text: 'c'.repeat(third) })
  })

  it('stops at the first over-budget row so kept history has no gaps', () => {
    const history = buildHistory([
      row('user', 'tiny'), // would fit, but sits behind the over-budget row
      row('assistant', 'x'.repeat(BUDGET_CHARS)),
      row('user', 'newest')
    ])
    expect(history).toEqual([
      { type: 'system', text: SYSTEM_PROMPT },
      { type: 'user', text: 'newest' }
    ])
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
