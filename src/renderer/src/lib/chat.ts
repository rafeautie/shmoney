import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  sqlFromParamsText,
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

/** One in-flight query tool call, keyed by callId within the streaming reply. */
export interface ActiveToolCall {
  callId: number
  /** raw params JSON streamed so far; sql derives from it until start supplies the real one */
  paramsText: string
  sql: string
  status: 'writing' | 'running' | 'done'
  result: QueryToolResult | null
}

/** The streamed reply so far; all-empty = still waiting for the first token. */
export interface ActiveReply {
  conversationId: number
  text: string
  /** the chain of thought streamed so far ('' when the model isn't thinking) */
  reasoning: string
  /** when the first reasoning chunk arrived; drives the live duration */
  reasoningStartedAt: number | null
  /** frozen once the answer (or a tool call) starts; the persisted row's value replaces it */
  reasoningMs: number | null
  /** query tool calls streamed so far, in call order */
  toolCalls: ActiveToolCall[]
}

/** a reply entry that hasn't streamed anything yet */
function emptyReply(conversationId: number): ActiveReply {
  return {
    conversationId,
    text: '',
    reasoning: '',
    reasoningStartedAt: null,
    reasoningMs: null,
    toolCalls: []
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
        return kind === 'reasoning'
          ? {
              ...base,
              reasoning: base.reasoning + text,
              reasoningStartedAt: base.reasoningStartedAt ?? Date.now()
            }
          : { ...base, text: base.text + text, reasoningMs: frozenReasoningMs(base) }
      })
    })
    const offTool = window.api.chat.onToolCall((event) => {
      setReply((prev) => {
        const base = entryFor(prev, event.conversationId)
        const calls = [...base.toolCalls]
        const index = calls.findIndex((c) => c.callId === event.callId)
        const current: ActiveToolCall =
          index >= 0
            ? calls[index]
            : { callId: event.callId, paramsText: '', sql: '', status: 'writing', result: null }
        let next: ActiveToolCall
        if (event.phase === 'params') {
          const paramsText = current.paramsText + event.chunk
          next = { ...current, paramsText, sql: sqlFromParamsText(paramsText) }
        } else if (event.phase === 'start') {
          next = { ...current, sql: event.sql, status: 'running' }
        } else {
          next = { ...current, status: 'done', result: event.result }
        }
        if (index >= 0) calls[index] = next
        else calls.push(next)
        return { ...base, toolCalls: calls, reasoningMs: frozenReasoningMs(base) }
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
