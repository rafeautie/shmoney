import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Conversation, ConversationMessages, StreamingChatPart } from '@shared/chat'
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

/**
 * The streamed reply so far: the assistant row's parts exactly as the
 * worker's turn log assembles them, patched in place by index. The renderer
 * assembles nothing — a patch replaces parts[index] wholesale — so the
 * streamed sequence and the persisted parts cannot drift. No parts = still
 * waiting for the first token. The array can be momentarily sparse when a
 * conversation is reopened mid-turn (earlier indexes fill in only as they
 * next patch); rendering skips the holes.
 */
export interface ActiveReply {
  conversationId: number
  parts: StreamingChatPart[]
}

/** a reply entry that hasn't streamed anything yet */
function emptyReply(conversationId: number): ActiveReply {
  return { conversationId, parts: [] }
}

/**
 * The reply currently streaming in (any conversation), applied from the chat
 * part-patch events. Call startReply once a send is accepted so the waiting
 * marker shows before the first token; the messageDone event settles the
 * reply into its placeholder row in the cache and clears the entry.
 */
export function useStreamingReply(): {
  reply: ActiveReply | null
  startReply: (conversationId: number) => void
} {
  const queryClient = useQueryClient()
  const [reply, setReply] = useState<ActiveReply | null>(null)

  useEffect(() => {
    const offPart = window.api.chat.onPart(({ conversationId, index, part }) => {
      setReply((prev) => {
        // a conversation reopened mid-turn has no entry yet; an event for
        // another conversation replaces the stale entry (chat is single-flight)
        const base =
          prev && prev.conversationId === conversationId ? prev : emptyReply(conversationId)
        const parts = [...base.parts]
        parts[index] = part
        return { ...base, parts }
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
      offPart()
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
