import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accounts, categories, chatMessages, conversations, transactions } from '../../db/schema'

// the send path needs a db shaped like drizzle's builder rather than the empty
// stub the pure-helper tests use; better-sqlite3 won't load under vitest
const inserted: string[] = []
let nextId = 1

function tableName(value: unknown): string | null {
  if (value === conversations) return 'conversations'
  if (value === chatMessages) return 'chatMessages'
  if (value === accounts) return 'accounts'
  if (value === categories) return 'categories'
  if (value === transactions) return 'transactions'
  return null
}

function builder(kind: 'select' | 'insert' | 'update', first: unknown): unknown {
  let table = tableName(first)
  let values: Record<string, unknown> = {}
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'get')
          return () => {
            if (kind === 'insert' && table === 'conversations')
              return {
                id: 1,
                title: 't',
                createdAt: 0,
                updatedAt: 0,
                lastMessageAt: 0,
                modelLabel: 'm',
                accountId: null,
                deletedAt: null
              }
            if (kind === 'insert' && table === 'chatMessages') return { id: nextId++, ...values }
            return undefined
          }
        if (prop === 'all') return () => []
        if (prop === 'run') return () => undefined
        return (...args: unknown[]) => {
          for (const arg of args) {
            const name = tableName(arg)
            if (name) {
              table = name
              if (kind === 'insert') inserted.push(name)
            }
          }
          if (prop === 'values' && typeof args[0] === 'object')
            values = args[0] as Record<string, unknown>
          return proxy
        }
      }
    }
  )
  if (kind === 'insert' && table) inserted.push(table)
  return proxy
}

vi.mock('../../db', () => ({
  db: {
    select: (arg: unknown) => builder('select', arg),
    insert: (arg: unknown) => builder('insert', arg),
    update: (arg: unknown) => builder('update', arg)
  }
}))
vi.mock('../../logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../manager', () => ({
  llmManager: {
    getStatus: () => ({ selected: 'e2b', models: { e2b: { stage: 'downloaded' } } }),
    chat: vi.fn()
  },
  sendToRenderer: vi.fn()
}))
vi.mock('../queue', () => ({ enqueueGenerate: vi.fn(() => Promise.resolve({ parts: [] })) }))
vi.mock('../../goals/summary', () => ({
  getGoalSummaries: vi.fn(() => {
    throw new Error('goal summaries exploded')
  })
}))
vi.mock('../../goals/series', () => ({ getGoalSeries: vi.fn(() => ({ rows: [] })) }))

const { sendChatMessage } = await import('./chat')

describe('sendChatMessage', () => {
  beforeEach(() => {
    inserted.length = 0
  })

  // a throw while gathering the turn's snapshot used to leave activeChat
  // claimed for the life of the process, locking chat out permanently
  it('does not strand the single-flight lock when the goal snapshot throws', async () => {
    await expect(
      sendChatMessage({ conversationId: null, accountId: null, text: 'hi' })
    ).rejects.toThrow('goal summaries exploded')
    // nothing was persisted, so there is no half-written turn to unwind
    expect(inserted).not.toContain('chatMessages')

    await expect(
      sendChatMessage({ conversationId: null, accountId: null, text: 'hi again' })
    ).rejects.not.toThrow('A chat reply is already being generated')
  })
})
