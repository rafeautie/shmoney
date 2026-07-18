import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sqlFromParamsText, type Conversation, type ConversationMessages } from '@shared/chat'
import { ipcErrorMessage } from '@/lib/utils'
import type { ChartCardState } from '@/components/chat/chat-chart'
import type { QueryCardState } from '@/components/chat/query-card'

export const CHAT_CONVERSATIONS_KEY = ['chat', 'conversations'] as const

export function chatMessagesKey(conversationId: number) {
  return ['chat', 'messages', conversationId] as const
}

export function useConversations() {
  return useQuery({
    queryKey: CHAT_CONVERSATIONS_KEY,
    queryFn: () => window.api.chat.listConversations()
  })
}

export function useMessages(conversationId: number | null) {
  return useQuery({
    queryKey: conversationId !== null ? chatMessagesKey(conversationId) : ['chat', 'messages'],
    queryFn: () => window.api.chat.listMessages(conversationId!),
    enabled: conversationId !== null
  })
}

/**
 * Send one turn. Resolves once the turn is accepted (the user message and the
 * reply's placeholder row are persisted); the reply then streams into the
 * placeholder — the chat page's push subscriptions handle it.
 */
export function useSendChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      conversationId: number | null
      text: string
      accountId: number | null
    }) => window.api.chat.send(input),
    onSuccess: ({ conversation, userMessage, assistantMessage }) => {
      queryClient.setQueryData<ConversationMessages>(chatMessagesKey(conversation.id), (prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, userMessage, assistantMessage] }
          : { messages: [userMessage, assistantMessage], truncatedBeforeId: null }
      )
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    },
    // the composer already cleared the text, so a swallowed rejection would
    // silently eat the message; say what went wrong instead
    onError: (error) => toast(ipcErrorMessage(error))
  })
}

export function useStopChat() {
  return useMutation({ mutationFn: () => window.api.chat.stop() })
}

/** Soft delete with an undo toast; Undo restores the row and its messages. */
export function useDeleteConversation() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
  return useMutation({
    mutationFn: (id: number) => window.api.chat.delete(id),
    onMutate: (id) => {
      queryClient.setQueryData<Conversation[]>(CHAT_CONVERSATIONS_KEY, (prev) =>
        prev?.filter((c) => c.id !== id)
      )
    },
    onSuccess: (_deleted, id) => {
      toast('Conversation deleted', {
        action: {
          label: 'Undo',
          onClick: () => {
            window.api.chat
              .restore(id)
              .then(invalidate)
              .catch(() => {})
          }
        }
      })
    },
    onSettled: invalidate
  })
}

export function useRenameConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: number; title: string }) => window.api.chat.rename(input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
  })
}

// ---------- the in-flight reply ----------

/**
 * One renderable entry of an assistant turn, live or settled, in the order it
 * arrived. A turn may think several times (think, call a tool, think again),
 * so reasoning is an ordinary item here rather than one field on the reply.
 * Tool calls are carried as the card states the cards already accept, so the
 * events this reducer sees turn into render-ready items once, with no second
 * derivation between here and the transcript. The in-flight bookkeeping
 * (callId, paramsText, startedAt) is absent on an item built from a persisted
 * part, which has no call or thought in flight.
 */
export type TurnItem =
  | { kind: 'text'; text: string }
  | {
      kind: 'reasoning'
      text: string
      /** frozen once the thought ends; null while it's still being written */
      durationMs: number | null
      /** when this thought's first chunk arrived; drives the live duration */
      startedAt?: number
    }
  | {
      kind: 'query'
      state: QueryCardState
      callId?: number
      /** raw params JSON streamed so far; the live sql preview parses from it */
      paramsText?: string
    }
  | { kind: 'chart'; state: ChartCardState; callId?: number }

/** The streamed reply so far; no items = still waiting for the first token. */
export interface ActiveReply {
  conversationId: number
  /** reasoning, answer text and tool calls in arrival order, mirroring the persisted parts */
  items: TurnItem[]
}

/** a reply entry that hasn't streamed anything yet */
function emptyReply(conversationId: number): ActiveReply {
  return { conversationId, items: [] }
}

/**
 * Anything non-reasoning (an answer chunk or a tool event) ends the thought
 * that was being written; freeze its live duration before the new item lands.
 */
function withFrozenReasoning(items: TurnItem[]): TurnItem[] {
  const next = [...items]
  const last = next[next.length - 1]
  if (last?.kind === 'reasoning' && last.durationMs === null)
    next[next.length - 1] = { ...last, durationMs: Date.now() - (last.startedAt ?? Date.now()) }
  return next
}

/**
 * The reply currently streaming in (any conversation), reduced from the chat
 * push events. Call startReply once a send is accepted so the waiting marker
 * shows before the first token; the messageDone event settles the reply into
 * its placeholder row in the cache and clears the entry.
 */
export function useStreamingReply(): {
  reply: ActiveReply | null
  startReply: (conversationId: number) => void
} {
  const queryClient = useQueryClient()
  const [reply, setReply] = useState<ActiveReply | null>(null)

  useEffect(() => {
    // a conversation reopened mid-turn has no entry yet; an event for another
    // conversation replaces the stale entry (chat is single-flight)
    const entryFor = (prev: ActiveReply | null, conversationId: number): ActiveReply =>
      prev && prev.conversationId === conversationId ? prev : emptyReply(conversationId)

    const offChunk = window.api.chat.onChunk(({ conversationId, text, kind }) => {
      setReply((prev) => {
        const base = entryFor(prev, conversationId)
        if (kind === 'reasoning') {
          // a thought merges into the trailing reasoning item, or opens a new
          // one if the model already moved on to text or a tool since. A
          // frozen thought is closed and never reopens: its duration is
          // already settled, so more text would grow it under a stale timing
          const items = [...base.items]
          const last = items[items.length - 1]
          if (last?.kind === 'reasoning' && last.durationMs === null)
            items[items.length - 1] = { ...last, text: last.text + text }
          else items.push({ kind: 'reasoning', text, startedAt: Date.now(), durationMs: null })
          return { ...base, items }
        }
        // answer text merges into the trailing text item, or opens a new one
        // right after a tool call, mirroring how the parts will persist. A
        // whitespace-only chunk with no item to merge into is the formatting
        // glue the model emits between two calls; the worker's turn log drops
        // it on persist, so it must not open an item here either, or the live
        // sequence would carry an index the settled one doesn't
        const items = withFrozenReasoning(base.items)
        const last = items[items.length - 1]
        if (last?.kind === 'text')
          items[items.length - 1] = { kind: 'text', text: last.text + text }
        else if (text.trim()) items.push({ kind: 'text', text })
        return { ...base, items }
      })
    })
    const offTool = window.api.chat.onToolCall((event) => {
      setReply((prev) => {
        const base = entryFor(prev, event.conversationId)
        const items = withFrozenReasoning(base.items)
        // each event finds its own card by callId; the call's first event
        // (always 'params') is the one that appends it
        const index = items.findIndex(
          (i) => (i.kind === 'query' || i.kind === 'chart') && i.callId === event.callId
        )
        const current = index >= 0 ? items[index] : null
        const callId = event.callId
        // phase before name: the params event types its name as a plain
        // string, so it is only within a phase that name discriminates
        let next: TurnItem
        if (event.phase === 'params') {
          if (event.name === 'chart') {
            next = { kind: 'chart', callId, state: { status: 'building', spec: null } }
          } else {
            // until 'start' supplies the real sql, it previews from the raw
            // params JSON streamed so far
            const paramsText =
              (current?.kind === 'query' ? (current.paramsText ?? '') : '') + event.chunk
            next = {
              kind: 'query',
              callId,
              paramsText,
              state: { status: 'writing', sql: sqlFromParamsText(paramsText) }
            }
          }
        } else if (event.phase === 'start') {
          next =
            event.name === 'chart'
              ? { kind: 'chart', callId, state: { status: 'building', spec: event.args } }
              : { kind: 'query', callId, state: { status: 'running', sql: event.args.sql } }
        } else if (event.name === 'chart') {
          // the spec only ever arrives on 'start', so it is carried forward
          // here rather than expected on the end event
          const state = current?.kind === 'chart' ? current.state : null
          next = {
            kind: 'chart',
            callId,
            state: {
              status: 'done',
              spec: state?.status === 'building' ? state.spec : null,
              display: event.display,
              error: event.result.error
            }
          }
        } else {
          // same for the sql: the end event carries no args back
          next = {
            kind: 'query',
            callId,
            state: {
              status: 'done',
              sql: current?.kind === 'query' ? current.state.sql : '',
              result: event.result
            }
          }
        }
        if (index >= 0) items[index] = next
        else items.push(next)
        return { ...base, items }
      })
    })
    const offDone = window.api.chat.onMessageDone(({ conversationId, message }) => {
      setReply(null)
      // the reply settles into its placeholder row in place — same id, same
      // list position — so the scroller never sees an element swap
      queryClient.setQueryData<ConversationMessages>(chatMessagesKey(conversationId), (prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) }
          : prev
      )
      // the refetch recomputes where the truncation marker sits now that the
      // turn is in the history
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(conversationId) })
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    })
    return () => {
      offChunk()
      offTool()
      offDone()
    }
  }, [queryClient])

  return { reply, startReply: (conversationId) => setReply(emptyReply(conversationId)) }
}

/** Save the conversation's account scope; optimistic so the selector doesn't flicker. */
export function useSetConversationAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: number; accountId: number | null }) =>
      window.api.chat.setAccount(input),
    onMutate: ({ id, accountId }) => {
      queryClient.setQueryData<Conversation[]>(CHAT_CONVERSATIONS_KEY, (prev) =>
        prev?.map((c) => (c.id === id ? { ...c, accountId } : c))
      )
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
  })
}
