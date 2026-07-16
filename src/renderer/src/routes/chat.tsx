import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import type { ChatMessage } from '@shared/chat'
import { CHAT_CONVERSATIONS_KEY, chatMessagesKey, useSendChat, useStopChat } from '@/lib/chat'
import { CATEGORIZE_MUTATION_KEY, useLlmStatus } from '@/lib/llm'
import { ChatInput, ChatInputNotice } from '@/components/chat/chat-input'
import { ChatModelGate } from '@/components/chat/chat-model-gate'
import { ChatView, type ActiveReply } from '@/components/chat/chat-view'
import { ConversationList } from '@/components/chat/conversation-list'

export const Route = createFileRoute('/chat')({
  component: ChatPage,
  validateSearch: (search: Record<string, unknown>): { c?: number } => {
    const c = Number(search.c)
    return Number.isInteger(c) && c > 0 ? { c } : {}
  }
})

function ChatPage() {
  const { c } = Route.useSearch()
  const conversationId = c ?? null
  const navigate = useNavigate({ from: '/chat' })
  const queryClient = useQueryClient()

  const stage = useLlmStatus().data?.stage ?? 'notDownloaded'
  // loading counts as available: the model is on disk and a turn is usable the
  // moment it finishes loading, so the page must not fall back to the gate
  const modelAvailable = stage === 'downloaded' || stage === 'ready' || stage === 'loading'
  const modelLoading = stage === 'loading'
  const categorizeRunning = useIsMutating({ mutationKey: CATEGORIZE_MUTATION_KEY }) > 0
  const sendChat = useSendChat()
  const stopChat = useStopChat()

  // the reply currently streaming in (any conversation); '' = awaiting first token
  const [reply, setReply] = useState<ActiveReply | null>(null)

  useEffect(() => {
    const offChunk = window.api.chat.onChunk(({ conversationId: id, text }) => {
      setReply((prev) =>
        prev && prev.conversationId === id
          ? { conversationId: id, text: prev.text + text }
          : { conversationId: id, text }
      )
    })
    const offDone = window.api.chat.onMessageDone(({ conversationId: id, message }) => {
      setReply(null)
      queryClient.setQueryData<ChatMessage[]>(chatMessagesKey(id), (prev) =>
        prev ? [...prev, message] : prev
      )
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    })
    return () => {
      offChunk()
      offDone()
    }
  }, [queryClient])

  const select = (id: number | null) =>
    void navigate({ search: id === null ? {} : { c: id }, replace: false })

  const send = (text: string) =>
    sendChat.mutate(
      { conversationId, text },
      {
        onSuccess: ({ conversation }) => {
          // treat the turn as in flight right away so the shimmer shows
          // before the first token; chunks then append to this entry
          setReply({ conversationId: conversation.id, text: '' })
          if (conversationId === null) select(conversation.id)
        }
      }
    )

  return (
    <div className="flex min-h-0 flex-1">
      <ConversationList activeId={conversationId} onSelect={select} />
      <div className="flex min-w-0 flex-1 flex-col">
        {!modelAvailable && conversationId === null ? (
          <ChatModelGate />
        ) : (
          <>
            <ChatView conversationId={conversationId} reply={reply} modelLoading={modelLoading} />
            {!modelAvailable ? (
              // existing conversations stay readable without the model; only
              // the composer gives way to an explanation
              <ChatInputNotice>
                The model isn&apos;t on this device, so this conversation is read-only. Start a new
                chat to download it.
              </ChatInputNotice>
            ) : (
              <ChatInput
                hasConversation={conversationId !== null}
                streaming={reply !== null}
                loading={modelLoading}
                disabled={categorizeRunning || sendChat.isPending}
                disabledHint={
                  categorizeRunning ? 'Chat is paused while auto-categorize runs' : undefined
                }
                onSend={send}
                onStop={() => stopChat.mutate()}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
