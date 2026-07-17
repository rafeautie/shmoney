import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import { sqlFromParamsText, type ConversationMessages } from '@shared/chat'
import {
  CHAT_CONVERSATIONS_KEY,
  chatMessagesKey,
  useConversations,
  useSendChat,
  useSetConversationAccount,
  useStopChat
} from '@/lib/chat'
import { CATEGORIZE_MUTATION_KEY, useLlmStatus } from '@/lib/llm'
import { ChatInput, ChatInputNotice } from '@/components/chat/chat-input'
import { ChatModelGate } from '@/components/chat/chat-model-gate'
import { ChatView, type ActiveReply, type ActiveToolCall } from '@/components/chat/chat-view'

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
    const offChunk = window.api.chat.onChunk(({ conversationId: id, text, kind }) => {
      setReply((prev) => {
        const base = prev && prev.conversationId === id ? prev : emptyReply(id)
        if (kind === 'reasoning') {
          return {
            ...base,
            reasoning: base.reasoning + text,
            reasoningStartedAt: base.reasoningStartedAt ?? Date.now()
          }
        }
        return {
          ...base,
          text: base.text + text,
          // the first answer chunk ends the thinking phase; freeze the live
          // duration until the persisted row's authoritative one replaces it
          reasoningMs:
            base.reasoningMs ??
            (base.reasoningStartedAt !== null ? Date.now() - base.reasoningStartedAt : null)
        }
      })
    })
    const offTool = window.api.chat.onToolCall((event) => {
      setReply((prev) => {
        const base =
          prev && prev.conversationId === event.conversationId
            ? prev
            : emptyReply(event.conversationId)
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
        return {
          ...base,
          toolCalls: calls,
          // a tool call ends the thinking phase the same way answer text does
          reasoningMs:
            base.reasoningMs ??
            (base.reasoningStartedAt !== null ? Date.now() - base.reasoningStartedAt : null)
        }
      })
    })
    const offDone = window.api.chat.onMessageDone(({ conversationId: id, message }) => {
      setReply(null)
      // the reply settles into its placeholder row in place — same id, same
      // list position — so the scroller never sees an element swap
      queryClient.setQueryData<ConversationMessages>(chatMessagesKey(id), (prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) }
          : prev
      )
      // the refetch recomputes where the truncation marker sits now that the
      // turn is in the history
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(id) })
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    })
    return () => {
      offChunk()
      offTool()
      offDone()
    }
  }, [queryClient])

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
          // treat the turn as in flight right away so the shimmer shows
          // before the first token; chunks then append to this entry
          setReply(emptyReply(conversation.id))
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
