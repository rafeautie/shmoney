import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  sqlFromParamsText,
  type ChartData,
  type ChartSpec,
  type Conversation,
  type ConversationMessages,
  type QueryToolResult
} from '@shared/chat'
import { ipcErrorMessage } from '@/lib/utils'

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

/** One in-flight tool call, keyed by callId within the streaming reply. */
export interface ActiveToolCall {
  callId: number
  /** which tool this call is; carried by every event from the first params chunk on */
  name: string
  /** raw params JSON streamed so far; sql derives from it until start supplies the real one */
  paramsText: string
  sql: string
  status: 'writing' | 'running' | 'done'
  /** a query call's settled result */
  result: QueryToolResult | null
  /** a successful chart call's renderable payload */
  chart: { spec: ChartSpec; data: ChartData; currency: string | null } | null
  /** a failed chart call's validation error */
  chartError: string | null
}

/** one streamed piece of the reply, in the order it arrived */
export type ActiveReplyItem =
  { kind: 'text'; text: string } | { kind: 'call'; call: ActiveToolCall }

/** The streamed reply so far; all-empty = still waiting for the first token. */
export interface ActiveReply {
  conversationId: number
  /** the chain of thought streamed so far ('' when the model isn't thinking) */
  reasoning: string
  /** when the first reasoning chunk arrived; drives the live duration */
  reasoningStartedAt: number | null
  /** frozen once the answer (or a tool call) starts; the persisted row's value replaces it */
  reasoningMs: number | null
  /** answer text and tool calls in arrival order, mirroring the persisted parts */
  items: ActiveReplyItem[]
}

/** a reply entry that hasn't streamed anything yet */
function emptyReply(conversationId: number): ActiveReply {
  return {
    conversationId,
    reasoning: '',
    reasoningStartedAt: null,
    reasoningMs: null,
    items: []
  }
}

/** the first answer chunk or tool call ends the thinking phase; freeze the live duration */
function frozenReasoningMs(reply: ActiveReply): number | null {
  return (
    reply.reasoningMs ??
    (reply.reasoningStartedAt !== null ? Date.now() - reply.reasoningStartedAt : null)
  )
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
        if (kind === 'reasoning')
          return {
            ...base,
            reasoning: base.reasoning + text,
            reasoningStartedAt: base.reasoningStartedAt ?? Date.now()
          }
        // answer text merges into the trailing text item, or opens a new one
        // right after a tool call — mirroring how the parts will persist
        const items = [...base.items]
        const last = items[items.length - 1]
        if (last?.kind === 'text')
          items[items.length - 1] = { kind: 'text', text: last.text + text }
        else items.push({ kind: 'text', text })
        return { ...base, items, reasoningMs: frozenReasoningMs(base) }
      })
    })
    const offTool = window.api.chat.onToolCall((event) => {
      setReply((prev) => {
        const base = entryFor(prev, event.conversationId)
        const items = [...base.items]
        const index = items.findIndex((i) => i.kind === 'call' && i.call.callId === event.callId)
        const existing = index >= 0 ? items[index] : null
        const current: ActiveToolCall =
          existing?.kind === 'call'
            ? existing.call
            : {
                callId: event.callId,
                name: event.name,
                paramsText: '',
                sql: '',
                status: 'writing',
                result: null,
                chart: null,
                chartError: null
              }
        let next: ActiveToolCall
        if (event.phase === 'params') {
          const paramsText = current.paramsText + event.chunk
          // sqlFromParamsText finds nothing in chart params, which is right
          next = { ...current, name: event.name, paramsText, sql: sqlFromParamsText(paramsText) }
        } else if (event.phase === 'start') {
          next =
            event.name === 'query'
              ? { ...current, name: event.name, sql: event.sql, status: 'running' }
              : { ...current, name: event.name, status: 'running' }
        } else if (event.name === 'query') {
          next = { ...current, name: event.name, status: 'done', result: event.result }
        } else {
          next = {
            ...current,
            name: event.name,
            status: 'done',
            chart: event.chart,
            chartError: event.result.ok ? null : (event.result.error ?? 'Chart failed.')
          }
        }
        if (index >= 0) items[index] = { kind: 'call', call: next }
        else items.push({ kind: 'call', call: next })
        return { ...base, items, reasoningMs: frozenReasoningMs(base) }
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
