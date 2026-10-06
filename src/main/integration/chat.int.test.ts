import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationStatus, type ChatMessagePart } from '@shared/chat'
import type {
  ChatMessageDoneEvent,
  Conversation,
  ChatPartEvent,
  ChatStatsEvent,
  SendChatInput,
  SendChatResult,
  StreamingChatPart
} from '@shared/chat'
import { LLM_MODELS, type GenerationStats } from '@shared/llm'
import { api } from './harness/api'
import { account, category } from './harness/builders'
import { count, query } from './harness/db'
import { fakeLlm } from './harness/fakes/llm'
import { expectUndoRoundTrip } from './harness/undo'

type ChatArgs = Parameters<Parameters<typeof fakeLlm.onChat>[0]>
type ChatHandler = Parameters<typeof fakeLlm.onChat>[0]
type ChatOpts = ChatArgs[2]

const text = (value: string): ChatMessagePart => ({ type: 'text', text: value })

const statsOf = (stopReason: GenerationStats['stopReason']): GenerationStats => ({
  modelId: 'qwen35-4b',
  inputTokens: 120,
  outputTokens: 40,
  decodeTokens: 38,
  decodeMs: 900,
  ttftMs: 150,
  prefillMs: 200,
  toolMs: 0,
  totalMs: 1300,
  loadMs: null,
  contextTokens: 160,
  contextSize: 12288,
  stopReason
})

/** every call the fake manager received, newest last */
const calls: ChatArgs[] = []

/** streams each part like the worker, then the final stats snapshot unless `stopReason` is null */
function reply(
  parts: ChatMessagePart[],
  extra: { stopReason?: GenerationStats['stopReason']; historyDropped?: number } = {}
): ChatHandler {
  const { stopReason = 'endOfTurn', historyDropped } = extra
  return async (...args) => {
    calls.push(args)
    const opts = args[2]
    parts.forEach((part, index) => opts.onPart(index, part))
    opts.onStats(statsOf(null))
    if (stopReason !== null) opts.onStats(statsOf(stopReason))
    return {
      parts,
      interrupted: false,
      ...(historyDropped === undefined ? {} : { historyDropped })
    }
  }
}

/** a turn that streams `partial`, then waits to be stopped like the real manager does */
function untilStopped(partial: ChatMessagePart[]): {
  handler: ChatHandler
  started: Promise<void>
} {
  let begin: () => void
  const started = new Promise<void>((resolve) => (begin = resolve))
  const handler: ChatHandler = async (...args) => {
    calls.push(args)
    const opts: ChatOpts = args[2]
    partial.forEach((part, index) => opts.onPart(index, part))
    opts.onStats(statsOf(null))
    begin()
    await new Promise<void>((resolve) =>
      opts.signal.addEventListener('abort', () => resolve(), { once: true })
    )
    opts.onStats(statsOf('aborted'))
    return { parts: partial, interrupted: true }
  }
  return { handler, started }
}

/** a turn held open until `release` runs, then answering `parts` */
function held(parts: ChatMessagePart[]): {
  handler: ChatHandler
  started: Promise<void>
  release: () => void
} {
  let begin: () => void
  let release: () => void
  const started = new Promise<void>((resolve) => (begin = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  const handler: ChatHandler = async (...args) => {
    calls.push(args)
    begin()
    await gate
    return { parts, interrupted: false }
  }
  return { handler, started, release: () => release() }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface Turn {
  sent: SendChatResult
  parts: ChatPartEvent[]
  stats: ChatStatsEvent[]
  /** resolves once the reply has settled and the single-flight lock is free */
  settled: Promise<ChatMessageDoneEvent>
}

/** sends a turn and collects its pushes; rejects when the send itself is refused */
async function start(input: SendChatInput): Promise<Turn> {
  const parts: ChatPartEvent[] = []
  const stats: ChatStatsEvent[] = []
  let done!: (event: ChatMessageDoneEvent) => void
  const finished = new Promise<ChatMessageDoneEvent>((resolve) => (done = resolve))
  const offs = [
    api.chat.onPart((event) => parts.push(event)),
    api.chat.onStats((event) => stats.push(event)),
    api.chat.onMessageDone(done)
  ]
  const off = (): void => offs.forEach((fn) => fn())
  let sent: SendChatResult
  try {
    sent = await api.chat.send(input)
  } catch (err) {
    off()
    throw err
  }
  const settled = finished.then(async (event) => {
    off()
    // messageDone goes out just before the lock is released
    await tick()
    return event
  })
  return { sent, parts, stats, settled }
}

async function turn(input: SendChatInput): Promise<Turn & { done: ChatMessageDoneEvent }> {
  const t = await start(input)
  return { ...t, done: await t.settled }
}

const ask = (prompt: string, conversationId: number | null = null): SendChatInput => ({
  conversationId,
  text: prompt,
  accountId: null
})

const conversationRow = (
  id: number
): {
  title: string | null
  model_label: string
  account_id: number | null
  deleted_at: number | null
  seen_reply_id: number | null
  truncated_before_id: number | null
  last_message_at: number | null
} =>
  query<{
    title: string | null
    model_label: string
    account_id: number | null
    deleted_at: number | null
    seen_reply_id: number | null
    truncated_before_id: number | null
    last_message_at: number | null
  }>(`SELECT * FROM conversations WHERE id = ${id}`)[0]

const messageRow = (
  id: number
): { status: string; parts: string; error_message: string | null; stats: string | null } =>
  query<{ status: string; parts: string; error_message: string | null; stats: string | null }>(
    `SELECT status, parts, error_message, stats FROM chat_messages WHERE id = ${id}`
  )[0]

const summary = async (id: number): Promise<Conversation | undefined> =>
  (await api.chat.listConversations()).find((c) => c.id === id)

afterEach(() => {
  calls.length = 0
  vi.useRealTimers()
})

describe('sending', () => {
  it('creates a conversation titled from the first line, stamped with the model', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('Hi')]))
    const { sent } = await turn(ask('  How much did I spend?\nIn detail please  '))

    expect(sent.conversation.title).toBe('How much did I spend?')
    expect(sent.conversation.modelLabel).toBe(LLM_MODELS['qwen35-4b'].label)
    expect(sent.conversation.accountId).toBeNull()
    const row = conversationRow(sent.conversation.id)
    expect(row.title).toBe('How much did I spend?')
    expect(row.model_label).toBe(LLM_MODELS['qwen35-4b'].label)
  })

  it('clips a title over 60 characters to 57 plus an ellipsis and keeps 60 whole', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const sixty = 'a'.repeat(60)
    const exact = await turn(ask(sixty))
    expect(exact.sent.conversation.title).toBe(sixty)

    const long = await turn(ask('b'.repeat(61)))
    expect(long.sent.conversation.title).toBe('b'.repeat(57) + '…')
  })

  it('stamps the model that is selected when the conversation is created', async () => {
    fakeLlm.ready()
    fakeLlm.setStage('downloaded', 'qwen35-2b')
    await api.llm.selectModel('qwen35-2b')
    fakeLlm.onChat(reply([text('ok')]))
    const { sent } = await turn(ask('Which model?'))
    expect(sent.conversation.modelLabel).toBe(LLM_MODELS['qwen35-2b'].label)
  })

  it('returns the user row and a streaming placeholder before the reply settles', async () => {
    fakeLlm.ready()
    const gate = held([text('Done')])
    fakeLlm.onChat(gate.handler)
    const t = await start(ask('  Hello  '))

    const { userMessage, assistantMessage, conversation } = t.sent
    expect(userMessage).toMatchObject({
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'Hello' }],
      conversationId: conversation.id
    })
    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      status: 'streaming',
      parts: [],
      stats: null,
      errorMessage: null,
      scope: { accountId: null, accountName: null }
    })
    expect(assistantMessage.id).toBeGreaterThan(userMessage.id)
    expect(messageRow(assistantMessage.id).status).toBe('streaming')
    expect((await summary(conversation.id))?.lastReply).toEqual({
      id: assistantMessage.id,
      status: 'streaming'
    })

    await gate.started
    gate.release()
    await t.settled
  })

  it('rejects empty and oversized text without writing anything', async () => {
    fakeLlm.ready()
    const before = [count('conversations'), count('chat_messages')]
    await expect(api.chat.send(ask('   '))).rejects.toThrow()
    await expect(api.chat.send(ask('x'.repeat(8001)))).rejects.toThrow()
    expect([count('conversations'), count('chat_messages')]).toEqual(before)
  })

  it('refuses a missing account on a new conversation', async () => {
    fakeLlm.ready()
    const before = [count('conversations'), count('chat_messages')]
    await expect(
      api.chat.send({ conversationId: null, text: 'Hi', accountId: 999_999 })
    ).rejects.toThrow('Account not found')
    expect([count('conversations'), count('chat_messages')]).toEqual(before)
    expect(calls).toHaveLength(0)
  })

  it('scopes a new conversation to a real account', async () => {
    const acct = account({ name: 'Scoped checking', currency: 'EUR' })
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const { sent, done } = await turn({ conversationId: null, text: 'Hi', accountId: acct })
    expect(sent.conversation.accountId).toBe(acct)
    expect(sent.assistantMessage.scope).toEqual({ accountId: acct, accountName: 'Scoped checking' })
    expect(done.message.scope).toEqual({ accountId: acct, accountName: 'Scoped checking' })
    expect(calls[0][2].toolScope).toEqual({ accountId: acct })
    expect(calls[0][2].currency).toBe('EUR')
  })

  it('ignores accountId when sending into an existing conversation', async () => {
    const acct = account()
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const first = await turn(ask('One'))
    await turn({ conversationId: first.sent.conversation.id, text: 'Two', accountId: acct })
    expect(conversationRow(first.sent.conversation.id).account_id).toBeNull()
    expect(calls[1][2].toolScope).toEqual({ accountId: null })
  })

  it('errors on a missing conversation and writes nothing', async () => {
    fakeLlm.ready()
    const before = count('chat_messages')
    await expect(api.chat.send(ask('Hi', 999_999))).rejects.toThrow('Conversation not found')
    expect(count('chat_messages')).toBe(before)
  })

  it('errors on a deleted conversation and writes nothing', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const { sent } = await turn(ask('Soon gone'))
    await api.chat.delete(sent.conversation.id)
    const before = count('chat_messages')
    await expect(api.chat.send(ask('Still there?', sent.conversation.id))).rejects.toThrow(
      'Conversation not found'
    )
    expect(count('chat_messages')).toBe(before)
  })

  it('refuses to send until the model is downloaded, and writes nothing', async () => {
    const before = [count('conversations'), count('chat_messages')]
    await expect(api.chat.send(ask('Anyone home?'))).rejects.toThrow('Model is not ready')
    fakeLlm.setStage('downloading')
    await expect(api.chat.send(ask('Anyone home?'))).rejects.toThrow(
      'Model is not ready (downloading)'
    )
    expect([count('conversations'), count('chat_messages')]).toEqual(before)
    expect(calls).toHaveLength(0)
  })
})

describe('streaming a reply', () => {
  it('pushes parts and stats, then settles the same row as complete with parts and stats', async () => {
    fakeLlm.ready()
    const parts: ChatMessagePart[] = [
      { type: 'reasoning', text: 'Thinking it over', durationMs: 120 },
      text('You spent '),
      text('$42')
    ]
    fakeLlm.onChat(reply(parts))
    const t = await turn(ask('Spending?'))

    const { conversation, assistantMessage } = t.sent
    expect(t.parts).toEqual(
      parts.map((part, index) => ({ conversationId: conversation.id, index, part }))
    )
    expect(t.stats.map((e) => e.stats.stopReason)).toEqual([null, 'endOfTurn'])
    expect(t.stats.every((e) => e.conversationId === conversation.id)).toBe(true)

    expect(t.done.conversationId).toBe(conversation.id)
    expect(t.done.message).toMatchObject({
      id: assistantMessage.id,
      role: 'assistant',
      status: 'complete',
      errorMessage: null,
      parts
    })
    expect(t.done.message.stats).toEqual(statsOf('endOfTurn'))

    const listed = await api.chat.listMessages(conversation.id)
    expect(listed.messages.map((m) => m.id)).toEqual([t.sent.userMessage.id, assistantMessage.id])
    expect(listed.messages[1]).toMatchObject({ status: 'complete', parts })
    expect(listed.truncatedBeforeId).toBeNull()
  })

  it('passes pending part forms through to the renderer unchanged', async () => {
    fakeLlm.ready()
    const pending: StreamingChatPart[] = [
      { type: 'reasoning', text: 'Still thinking', durationMs: null },
      { type: 'functionCall', name: 'query' }
    ]
    fakeLlm.onChat(async (...args) => {
      const opts = args[2]
      pending.forEach((part, index) => opts.onPart(index, part))
      return { parts: [text('Final')], interrupted: false }
    })
    const t = await turn(ask('Pending parts'))
    expect(t.parts.map((e) => e.part)).toEqual(pending)
    expect(t.done.message.parts).toEqual([text('Final')])
  })

  it('persists no stats when the last snapshot has no stopReason', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('Cut short')], { stopReason: null }))
    const t = await turn(ask('No final stats'))
    expect(t.stats).toHaveLength(1)
    expect(t.done.message.status).toBe('complete')
    expect(t.done.message.stats).toBeNull()
    expect(messageRow(t.sent.assistantMessage.id).stats).toBeNull()
  })

  it('persists the final stats of a turn that ended on any stop reason', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('Long answer')], { stopReason: 'maxTokens' }))
    const t = await turn(ask('Ramble'))
    expect(t.done.message.stats).toEqual(statsOf('maxTokens'))
    expect(JSON.parse(messageRow(t.sent.assistantMessage.id).stats!)).toEqual(statsOf('maxTokens'))
  })

  it('bumps the conversation to the top of the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    vi.setSystemTime(new Date(2026, 9, 1, 9))
    const a = await turn(ask('Older'))
    vi.setSystemTime(new Date(2026, 9, 1, 10))
    const b = await turn(ask('Newer'))

    const ids = (await api.chat.listConversations()).map((c) => c.id)
    expect(ids.indexOf(b.sent.conversation.id)).toBeLessThan(ids.indexOf(a.sent.conversation.id))

    vi.setSystemTime(new Date(2026, 9, 1, 11))
    await turn(ask('Back to the first', a.sent.conversation.id))
    const after = (await api.chat.listConversations()).map((c) => c.id)
    expect(after.indexOf(a.sent.conversation.id)).toBeLessThan(
      after.indexOf(b.sent.conversation.id)
    )
    expect(conversationRow(a.sent.conversation.id).last_message_at).toBeGreaterThan(
      conversationRow(b.sent.conversation.id).last_message_at!
    )
  })
})

describe('single flight', () => {
  it('refuses a second send while a reply is generating, then frees the lock', async () => {
    fakeLlm.ready()
    const gate = held([text('First')])
    fakeLlm.onChat(gate.handler)
    const first = await start(ask('First'))
    await gate.started

    const before = [count('conversations'), count('chat_messages')]
    await expect(api.chat.send(ask('Second'))).rejects.toThrow(
      'A chat reply is already being generated'
    )
    expect([count('conversations'), count('chat_messages')]).toEqual(before)

    gate.release()
    await first.settled
    fakeLlm.onChat(reply([text('Second answer')]))
    const second = await turn(ask('Second'))
    expect(second.done.message.status).toBe('complete')
  })

  it('frees the lock after an error', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(async () => {
      throw new Error('Model crashed')
    })
    const failed = await turn(ask('Boom'))
    expect(failed.done.message.status).toBe('error')

    fakeLlm.onChat(reply([text('Recovered')]))
    const next = await turn(ask('Again'))
    expect(next.done.message.status).toBe('complete')
  })

  it('frees the lock after a stop', async () => {
    fakeLlm.ready()
    const stoppable = untilStopped([text('Partial')])
    fakeLlm.onChat(stoppable.handler)
    const t = await start(ask('Stop me'))
    await stoppable.started
    await api.chat.stop()
    await t.settled

    fakeLlm.onChat(reply([text('Fresh')]))
    const next = await turn(ask('Go on'))
    expect(next.done.message.status).toBe('complete')
  })
})

describe('stop and failure', () => {
  it('keeps the partial parts of a stopped turn as interrupted', async () => {
    fakeLlm.ready()
    const stoppable = untilStopped([text('Half an ans')])
    fakeLlm.onChat(stoppable.handler)
    const t = await start(ask('Long one'))
    await stoppable.started
    expect(messageRow(t.sent.assistantMessage.id).status).toBe('streaming')

    await api.chat.stop()
    const done = await t.settled
    expect(done.message).toMatchObject({
      id: t.sent.assistantMessage.id,
      status: 'interrupted',
      errorMessage: null,
      parts: [text('Half an ans')]
    })
    expect(done.message.stats?.stopReason).toBe('aborted')
    expect(JSON.parse(messageRow(t.sent.assistantMessage.id).parts)).toEqual([text('Half an ans')])
  })

  it('settles as interrupted, not error, when the manager rejects after a stop', async () => {
    fakeLlm.ready()
    let begin!: () => void
    const started = new Promise<void>((resolve) => (begin = resolve))
    fakeLlm.onChat(async (...args) => {
      const { signal } = args[2]
      begin()
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
      throw signal.reason
    })
    const t = await start(ask('Stop before it starts'))
    await started
    await api.chat.stop()
    const { message } = await t.settled
    expect(message).toMatchObject({ status: 'interrupted', errorMessage: null, parts: [] })
  })

  it('treats stop with nothing in flight as a no-op', async () => {
    await expect(api.chat.stop()).resolves.toBeUndefined()
  })

  it('settles a thrown error as status error with the message', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(async () => {
      throw new Error('Out of memory')
    })
    const t = await turn(ask('Crash'))
    expect(t.done.message).toMatchObject({
      id: t.sent.assistantMessage.id,
      status: 'error',
      errorMessage: 'Out of memory',
      parts: [],
      stats: null
    })
    const listed = await api.chat.listMessages(t.sent.conversation.id)
    expect(listed.messages[1]).toMatchObject({ status: 'error', errorMessage: 'Out of memory' })
    expect((await summary(t.sent.conversation.id))?.lastReply).toEqual({
      id: t.sent.assistantMessage.id,
      status: 'error'
    })
  })

  it('refuses a turn whose model was deleted after the gate passed', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(async () => {
      fakeLlm.setStage('notDownloaded')
      throw new Error('Model is not downloaded (notDownloaded)')
    })
    const t = await turn(ask('Vanishing model'))
    expect(t.done.message.status).toBe('error')
    expect(t.done.message.errorMessage).toContain('not downloaded')
  })

  // chat.ts launchGeneration catch: finishTurn gets { parts: [] }, so what the
  // renderer already showed through chat:part vanishes when the row settles
  it.todo(
    'TRIAGE: an error mid-turn discards parts that already streamed (src/main/llm/features/chat.ts:601-608, the aborted-reject and error branches of launchGeneration both pass parts: [])'
  )
})

describe('history and scope', () => {
  it('hands earlier turns to the model on a follow-up', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('First answer')]))
    const first = await turn(ask('First question'))
    fakeLlm.onChat(reply([text('Second answer')]))
    await turn(ask('Second question', first.sent.conversation.id))

    const [history, prompt] = calls[1]
    expect(prompt).toBe('Second question')
    expect(history.map((item) => item.type)).toEqual(['system', 'user', 'model'])
    expect(history[1]).toEqual({ type: 'user', text: 'First question' })
    expect(history[2]).toEqual({ type: 'model', response: ['First answer'] })
    // the first turn saw only the system prompt
    expect(calls[0][0].map((item) => item.type)).toEqual(['system'])
  })

  it('leaves errored replies out of history and keeps stopped partials', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(async () => {
      throw new Error('Nope')
    })
    const first = await turn(ask('Fails'))
    const id = first.sent.conversation.id

    const stoppable = untilStopped([text('Partial reply')])
    fakeLlm.onChat(stoppable.handler)
    const second = await start(ask('Gets stopped', id))
    await stoppable.started
    await api.chat.stop()
    await second.settled

    fakeLlm.onChat(reply([text('Third')]))
    await turn(ask('Third question', id))
    const history = calls[calls.length - 1][0]
    expect(history.slice(1)).toEqual([
      { type: 'user', text: 'Fails' },
      { type: 'user', text: 'Gets stopped' },
      { type: 'model', response: ['Partial reply'] }
    ])
  })

  it('replays tool calls with query rows expired and seeds the next turn with the last data call', async () => {
    fakeLlm.ready()
    const queryCall: ChatMessagePart = {
      type: 'functionCall',
      durationMs: 5,
      name: 'query',
      args: { sql: 'select 1' },
      result: { ok: true, columns: ['n'], rows: [[1]], rowCount: 1, durationMs: 2 }
    }
    fakeLlm.onChat(reply([queryCall, text('One row.')]))
    const first = await turn(ask('Run it'))
    fakeLlm.onChat(reply([text('Sure')]))
    await turn(ask('Again', first.sent.conversation.id))

    const [history, , opts] = calls[1]
    const model = history[2]
    expect(model).toMatchObject({
      type: 'model',
      response: [
        {
          type: 'functionCall',
          name: 'query',
          params: { sql: 'select 1' },
          result: { ok: true, rowCount: 1 }
        },
        'One row.'
      ]
    })
    const replayed = (model as { response: { result: { note: string; rows?: unknown } }[] })
      .response[0].result
    expect(replayed.note).toContain('Expired')
    expect(replayed.rows).toBeUndefined()
    expect(opts.tools.seed).toEqual({ name: 'query', args: { sql: 'select 1' }, chart: null })
    expect(calls[0][2].tools.seed).toBeNull()
  })

  it('maps historyDropped to the message the model still sees first', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('Answer one')]))
    const first = await turn(ask('Question one'))
    const id = first.sent.conversation.id

    // history items are [user1, reply1, user2]; dropping 2 leaves user2 first
    fakeLlm.onChat(reply([text('Answer two')], { historyDropped: 2 }))
    const second = await turn(ask('Question two', id))
    expect(conversationRow(id).truncated_before_id).toBe(second.sent.userMessage.id)
    expect((await api.chat.listMessages(id)).truncatedBeforeId).toBe(second.sent.userMessage.id)

    // a turn that reports nothing dropped clears the marker
    fakeLlm.onChat(reply([text('Answer three')], { historyDropped: 0 }))
    await turn(ask('Question three', id))
    expect(conversationRow(id).truncated_before_id).toBeNull()
    expect((await api.chat.listMessages(id)).truncatedBeforeId).toBeNull()
  })

  it('points at the first replayed row when only the oldest turn is cut', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('Answer one')]))
    const first = await turn(ask('Question one'))
    const id = first.sent.conversation.id
    fakeLlm.onChat(reply([text('Answer two')], { historyDropped: 1 }))
    await turn(ask('Question two', id))
    expect(conversationRow(id).truncated_before_id).toBe(first.sent.assistantMessage.id)
  })

  it('leaves the marker alone when the turn never reached the model', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('Answer one')]))
    const first = await turn(ask('Question one'))
    const id = first.sent.conversation.id
    fakeLlm.onChat(reply([text('Answer two')], { historyDropped: 2 }))
    const second = await turn(ask('Question two', id))

    fakeLlm.onChat(async () => {
      throw new Error('Failed to load')
    })
    await turn(ask('Question three', id))
    expect(conversationRow(id).truncated_before_id).toBe(second.sent.userMessage.id)
  })

  it('passes the conversation account as the tool scope, and widens when it is deleted', async () => {
    const acct = account({ name: 'Doomed' })
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const first = await turn({ conversationId: null, text: 'Scoped', accountId: acct })
    const id = first.sent.conversation.id
    expect(calls[0][2].toolScope).toEqual({ accountId: acct })

    const second = await turn(ask('Still scoped', id))
    expect(calls[1][2].toolScope).toEqual({ accountId: acct })
    expect(second.sent.assistantMessage.scope).toEqual({ accountId: acct, accountName: 'Doomed' })

    expect(await api.accounts.delete(acct)).toBe(true)
    const third = await turn(ask('Account is gone', id))
    expect(calls[2][2].toolScope).toEqual({ accountId: null })
    expect(third.sent.assistantMessage.scope).toEqual({ accountId: null, accountName: null })
    expect(conversationRow(id).account_id).toBeNull()
  })

  it('applies a rescope on the next turn only', async () => {
    const acct = account({ name: 'Rescoped' })
    fakeLlm.ready()
    const gate = held([text('First')])
    fakeLlm.onChat(gate.handler)
    const first = await start(ask('Start wide'))
    await gate.started
    const id = first.sent.conversation.id
    expect(await api.chat.setAccount({ id, accountId: acct })).toBe(true)
    gate.release()
    await first.settled
    expect(calls[0][2].toolScope).toEqual({ accountId: null })

    fakeLlm.onChat(reply([text('Second')]))
    const second = await turn(ask('Now narrow', id))
    expect(calls[1][2].toolScope).toEqual({ accountId: acct })
    expect(second.sent.assistantMessage.scope?.accountId).toBe(acct)
  })
})

describe('conversation CRUD', () => {
  it('lists live conversations, newest message first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    vi.setSystemTime(new Date(2027, 0, 1, 9))
    const a = await turn(ask('List A'))
    vi.setSystemTime(new Date(2027, 0, 1, 10))
    const b = await turn(ask('List B'))
    vi.setSystemTime(new Date(2027, 0, 1, 11))
    const c = await turn(ask('List C'))

    const ids = (): Promise<number[]> =>
      api.chat.listConversations().then((all) => all.map((x) => x.id))
    const order = [c, b, a].map((x) => x.sent.conversation.id)
    expect((await ids()).filter((id) => order.includes(id))).toEqual(order)

    await api.chat.delete(b.sent.conversation.id)
    expect(await ids()).not.toContain(b.sent.conversation.id)
    expect((await ids()).filter((id) => order.includes(id))).toEqual([
      c.sent.conversation.id,
      a.sent.conversation.id
    ])
  })

  it('renames with trim, reports a no-op, and undoes', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const { sent } = await turn(ask('Original title'))
    const id = sent.conversation.id

    await expectUndoRoundTrip(async () => {
      expect(await api.chat.rename({ id, title: '  Renamed  ' })).toBe(true)
    })
    expect(conversationRow(id).title).toBe('Renamed')

    const entries = count('action_log')
    expect(await api.chat.rename({ id, title: ' Renamed ' })).toBe(false)
    expect(count('action_log')).toBe(entries)
    expect(await api.chat.rename({ id: 999_999, title: 'Nothing here' })).toBe(false)
    expect(count('action_log')).toBe(entries)
  })

  it('rejects a blank or overlong title', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const { sent } = await turn(ask('Keep this title'))
    const id = sent.conversation.id
    await expect(api.chat.rename({ id, title: '   ' })).rejects.toThrow()
    await expect(api.chat.rename({ id, title: 'x'.repeat(201) })).rejects.toThrow()
    expect(conversationRow(id).title).toBe('Keep this title')
  })

  it('soft deletes with an undoable entry and reports a second delete as null', async () => {
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const { sent } = await turn(ask('To delete'))
    const id = sent.conversation.id
    const messages = count('chat_messages', `conversation_id = ${id}`)

    // the round trip leaves the redo applied, so the conversation ends deleted
    const entry = await expectUndoRoundTrip(async () => {
      expect(await api.chat.delete(id)).toEqual(expect.any(Number))
    })
    expect(conversationRow(id).deleted_at).not.toBeNull()
    expect(count('chat_messages', `conversation_id = ${id}`)).toBe(messages)
    expect(await summary(id)).toBeUndefined()

    expect(await api.chat.delete(id)).toBeNull()
    expect(await api.chat.delete(999_999)).toBeNull()

    await api.actionLog.undoEntry(entry)
    expect(await summary(id)).toMatchObject({ id, title: 'To delete' })
  })

  it('tracks the reply status and what the user has seen', async () => {
    fakeLlm.ready()
    const gate = held([text('Answer')])
    fakeLlm.onChat(gate.handler)
    const t = await start(ask('Watch me'))
    const id = t.sent.conversation.id
    await gate.started

    let c = (await summary(id))!
    expect(conversationStatus(c)).toBe('busy')
    // a reply still streaming is not seen-able
    await api.chat.markSeen(id)
    expect(conversationRow(id).seen_reply_id).toBeNull()

    gate.release()
    await t.settled
    c = (await summary(id))!
    expect(c.lastReply).toEqual({ id: t.sent.assistantMessage.id, status: 'complete' })
    expect(conversationStatus(c)).toBe('unread')

    await api.chat.markSeen(id)
    c = (await summary(id))!
    expect(c.seenReplyId).toBe(t.sent.assistantMessage.id)
    expect(conversationStatus(c)).toBeNull()

    fakeLlm.onChat(async () => {
      throw new Error('Broke')
    })
    const failed = await turn(ask('Fail now', id))
    c = (await summary(id))!
    expect(c.lastReply).toEqual({ id: failed.sent.assistantMessage.id, status: 'error' })
    expect(conversationStatus(c)).toBe('failed')
    await api.chat.markSeen(id)
    expect(conversationStatus((await summary(id))!)).toBeNull()
  })

  it('narrows, widens and reports a missing conversation on setAccount', async () => {
    const acct = account({ name: 'Narrow' })
    fakeLlm.ready()
    fakeLlm.onChat(reply([text('ok')]))
    const { sent } = await turn(ask('Scope me'))
    const id = sent.conversation.id

    expect(await api.chat.setAccount({ id, accountId: acct })).toBe(true)
    expect((await summary(id))?.accountId).toBe(acct)
    expect(await api.chat.setAccount({ id, accountId: null })).toBe(true)
    expect((await summary(id))?.accountId).toBeNull()
    expect(await api.chat.setAccount({ id: 999_999, accountId: null })).toBe(false)
  })

  it('rejects ids that are not positive integers', async () => {
    await expect(api.chat.listMessages(0)).rejects.toThrow()
    await expect(api.chat.delete(-1)).rejects.toThrow()
    await expect(api.chat.setAccount({ id: 1.5, accountId: null })).rejects.toThrow()
  })

  it('lists no messages for a conversation that never existed', async () => {
    expect(await api.chat.listMessages(999_999)).toEqual({ messages: [], truncatedBeforeId: null })
  })

  // chat.ts listMessages and the chat:renameConversation / chat:setConversationAccount
  // handlers filter on id alone, never deleted_at (sendChatMessage does check it)
  it.todo(
    'TRIAGE: listMessages returns the messages of a soft-deleted conversation (src/main/llm/features/chat.ts:314 listMessages has no deletedAt filter)'
  )
  it.todo(
    'TRIAGE: rename works on a deleted conversation and logs an undoable action (src/main/ipc/chat.ts:60 renameConversation has no deletedAt filter)'
  )
  it.todo(
    'TRIAGE: setConversationAccount works on a deleted conversation (src/main/ipc/chat.ts:50 setConversationAccount has no deletedAt filter)'
  )
  it.todo(
    'TRIAGE: setConversationAccount with a nonexistent account rejects with a raw "FOREIGN KEY constraint failed" instead of the "Account not found" send gives (src/main/ipc/chat.ts:50)'
  )
})

describe('proposals', () => {
  it('applies a set_budget proposal from a reply and undoes it', async () => {
    const dining = category('Proposal dining')
    fakeLlm.ready()
    fakeLlm.onChat(
      reply([
        {
          type: 'functionCall',
          durationMs: 1,
          name: 'set_budget',
          args: {},
          result: { ok: true, summary: 'Proposed.' },
          display: {
            proposal: {
              kind: 'set_budget',
              categoryId: dining,
              category: 'Proposal dining',
              month: '2026-09',
              before: null,
              after: 300,
              averageSpending: null,
              currency: 'USD'
            },
            status: 'approval-requested',
            actionId: null,
            applied: null,
            skipped: null
          }
        }
      ])
    )
    const { done } = await turn(ask('Budget 300 for dining'))
    const fill = (): unknown[] => query(`SELECT amount FROM budgets WHERE category_id = ${dining}`)

    const approved = await api.chat.resolveProposal({
      messageId: done.message.id,
      partIndex: 0,
      decision: 'approve'
    })
    expect(approved.parts[0]).toMatchObject({ display: { status: 'approved', applied: 1 } })
    expect(fill()).toEqual([{ amount: 300_000 }])
    await expect(
      api.chat.resolveProposal({ messageId: done.message.id, partIndex: 0, decision: 'deny' })
    ).rejects.toThrow()

    const undone = await api.chat.undoProposal({ messageId: done.message.id, partIndex: 0 })
    expect(undone.parts[0]).toMatchObject({ display: { status: 'undone' } })
    expect(fill()).toEqual([])
  })
})
