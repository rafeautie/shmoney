import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useIsMutating } from '@tanstack/react-query'
import {
  useConversations,
  useSendChat,
  useSetConversationAccount,
  useStopChat,
  useStreamingReply
} from '@/lib/chat'
import { CATEGORIZE_MUTATION_KEY, useLlmStatus } from '@/lib/llm'
import { ChatInput } from '@/components/chat/chat-input'
import { ChatInputNotice } from '@/components/chat/chat-input-notice'
import { ChatModelGate } from '@/components/chat/chat-model-gate'
import { ChatView } from '@/components/chat/chat-view'

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

  const stage = useLlmStatus().data?.stage ?? 'notDownloaded'
  // loading counts as available: the model is on disk and a turn is usable the
  // moment it finishes loading, so the page must not fall back to the gate
  const modelAvailable = stage === 'downloaded' || stage === 'ready' || stage === 'loading'
  const modelLoading = stage === 'loading'
  const categorizeRunning = useIsMutating({ mutationKey: CATEGORIZE_MUTATION_KEY }) > 0
  const sendChat = useSendChat()
  const stopChat = useStopChat()

  const { reply, startReply } = useStreamingReply()

  // scope: a new chat's selection is local until the first send creates the
  // conversation with it; an existing chat's lives on the conversation row
  const conversations = useConversations().data
  const [draftAccountId, setDraftAccountId] = useState<number | null>(null)
  const scopeAccountId =
    conversationId === null
      ? draftAccountId
      : (conversations?.find((conv) => conv.id === conversationId)?.accountId ?? null)
  const setAccount = useSetConversationAccount()
  const changeScope = (accountId: number | null) => {
    if (conversationId === null) setDraftAccountId(accountId)
    else setAccount.mutate({ id: conversationId, accountId })
  }

  // opening an existing conversation invalidates the composer's draft scope,
  // so the next new chat starts unscoped; existing chats read scope from
  // their row (render-time reset, since navigation can come from sidebar
  // links, not just local handlers)
  const [scopeOwner, setScopeOwner] = useState(conversationId)
  if (scopeOwner !== conversationId) {
    setScopeOwner(conversationId)
    if (conversationId !== null) setDraftAccountId(null)
  }

  const select = (id: number | null) => {
    void navigate({ search: id === null ? {} : { c: id }, replace: false })
  }

  const send = (text: string) =>
    sendChat.mutate(
      { conversationId, text, accountId: conversationId === null ? draftAccountId : null },
      {
        onSuccess: ({ conversation }) => {
          startReply(conversation.id)
          if (conversationId === null) select(conversation.id)
        }
      }
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              accountId={scopeAccountId}
              onAccountChange={changeScope}
              onSend={send}
              onStop={() => stopChat.mutate()}
            />
          )}
        </>
      )}
    </div>
  )
}
