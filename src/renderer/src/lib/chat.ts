import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatMessage, Conversation } from '@shared/chat'
import { ipcErrorMessage } from '@/lib/utils'
import { useNotify } from '@/lib/notify-store'

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
 * Send one turn. Resolves once the turn is accepted (rows persisted); the
 * reply streams in afterwards — the chat page's push subscriptions handle it.
 */
export function useSendChat() {
  const queryClient = useQueryClient()
  const notify = useNotify()
  return useMutation({
    mutationFn: (input: { conversationId: number | null; text: string }) =>
      window.api.chat.send(input),
    onSuccess: ({ conversation, userMessage }) => {
      queryClient.setQueryData<ChatMessage[]>(chatMessagesKey(conversation.id), (prev) =>
        prev ? [...prev, userMessage] : [userMessage]
      )
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    },
    onError: (error) => notify.error(ipcErrorMessage(error))
  })
}

export function useStopChat() {
  return useMutation({ mutationFn: () => window.api.chat.stop() })
}

/** Soft delete with an undo action, matching the app's no-confirm convention. */
export function useDeleteConversation() {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
  return useMutation({
    mutationFn: (id: number) => window.api.chat.delete(id),
    onMutate: (id) => {
      queryClient.setQueryData<Conversation[]>(CHAT_CONVERSATIONS_KEY, (prev) =>
        prev?.filter((c) => c.id !== id)
      )
    },
    onSuccess: (_ok, id) => {
      notify('Conversation deleted', {
        action: {
          label: 'Undo',
          onClick: () => void window.api.chat.restore(id).then(invalidate)
        }
      })
    },
    onError: (error) => {
      notify.error(ipcErrorMessage(error))
      invalidate()
    }
  })
}

export function useRenameConversation() {
  const queryClient = useQueryClient()
  const notify = useNotify()
  return useMutation({
    mutationFn: (input: { id: number; title: string }) => window.api.chat.rename(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY }),
    onError: (error) => notify.error(ipcErrorMessage(error))
  })
}
