import { useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  conversationStatus,
  type ChatMessage,
  type Conversation,
  type ConversationMessages,
  type Proposal,
  type ResolveProposalInput,
  type StreamingChatPart,
  type UndoProposalInput
} from '@shared/chat'
import type { GenerationStats } from '@shared/llm'
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
      // a quick turn can settle before send resolves; keep its final form
      const reply = lastSettled?.id === assistantMessage.id ? lastSettled : assistantMessage
      queryClient.setQueryData<ConversationMessages>(chatMessagesKey(conversation.id), (prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages.filter((m) => m.id !== userMessage.id && m.id !== reply.id),
                userMessage,
                reply
              ]
            }
          : { messages: [userMessage, reply], truncatedBeforeId: null }
      )
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    },
    // the composer already cleared the text, so a swallowed rejection would
    // silently eat the message; say what went wrong instead
    onError: (error) => toast(ipcErrorMessage(error))
  })
}

/** The open thread's finished reply counts as read, clearing its sidebar dot. */
export function useMarkConversationSeen(conversation: Conversation | undefined): void {
  const queryClient = useQueryClient()
  const status = conversation ? conversationStatus(conversation) : null
  const id = conversation?.id
  useEffect(() => {
    if (id === undefined || (status !== 'unread' && status !== 'failed')) return
    void window.api.chat
      .markSeen(id)
      .then(() => queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY }))
  }, [id, status, queryClient])
}

export function useStopChat() {
  return useMutation({ mutationFn: () => window.api.chat.stop() })
}

/** Soft delete with an undo toast; Undo replays the same action-log entry Ctrl+Z would. */
export function useDeleteConversation() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  }
  return useMutation({
    mutationFn: (id: number) => window.api.chat.delete(id),
    onMutate: (id) => {
      queryClient.setQueryData<Conversation[]>(CHAT_CONVERSATIONS_KEY, (prev) =>
        prev?.filter((c) => c.id !== id)
      )
    },
    onSuccess: (actionId) => {
      if (actionId === null) return
      toast('Conversation deleted', {
        action: {
          label: 'Undo',
          onClick: () => {
            window.api.actionLog
              .undoEntry(actionId)
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
    }
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
  /** the latest usage snapshot; null until the worker reports one */
  stats: GenerationStats | null
}

/** a reply entry that hasn't streamed anything yet */
function emptyReply(conversationId: number): ActiveReply {
  return { conversationId, parts: [], stats: null }
}

// The live reply lives outside React state so a patch re-renders only the
// streaming row (useActiveReply), never the page, the composer or settled
// rows. Patches apply to `working` at once and publish at most once a frame.
let working: ActiveReply | null = null
let published: ActiveReply | null = null
// the newest reply messageDone settled; chat is single-flight, so one is enough
// to tell a send that resolves after its own reply finished
let lastSettled: ChatMessage | null = null
let frame = 0
const listeners = new Set<() => void>()

function publish(): void {
  cancelAnimationFrame(frame)
  frame = 0
  published = working
  listeners.forEach((listener) => listener())
}

function subscribeReply(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** the streamed reply when it belongs to this conversation; null otherwise (or for null) */
export function useActiveReply(conversationId: number | null): ActiveReply | null {
  return useSyncExternalStore(subscribeReply, () =>
    conversationId !== null && published?.conversationId === conversationId ? published : null
  )
}

/** the conversation a reply is streaming into, if any; changes only per turn */
export function useStreamingConversationId(): number | null {
  return useSyncExternalStore(subscribeReply, () => published?.conversationId ?? null)
}

/**
 * Applies the chat part-patch events to the live reply (any conversation)
 * while mounted. Call startReply once a send is accepted so the waiting
 * marker shows before the first token; the messageDone event settles the
 * reply into its placeholder row in the cache and clears the entry.
 */
export function useStreamingReply(): {
  startReply: (conversationId: number, replyId: number) => void
} {
  const queryClient = useQueryClient()

  useEffect(() => {
    // a conversation reopened mid-turn has no entry yet; an event for another
    // conversation replaces the stale entry (chat is single-flight)
    const patch = (conversationId: number, update: (base: ActiveReply) => ActiveReply) => {
      const base =
        working && working.conversationId === conversationId ? working : emptyReply(conversationId)
      working = update(base)
      frame ||= requestAnimationFrame(publish)
    }
    const offPart = window.api.chat.onPart(({ conversationId, index, part }) =>
      patch(conversationId, (base) => {
        const parts = [...base.parts]
        parts[index] = part
        return { ...base, parts }
      })
    )
    const offStats = window.api.chat.onStats(({ conversationId, stats }) =>
      patch(conversationId, (base) => ({ ...base, stats }))
    )
    const offDone = window.api.chat.onMessageDone(({ conversationId, message }) => {
      lastSettled = message
      // the reply settles into its placeholder row in place — same id, same
      // list position — so the scroller never sees an element swap
      queryClient.setQueryData<ConversationMessages>(chatMessagesKey(conversationId), (prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) }
          : prev
      )
      // cleared on a zero timeout queued behind the query's own notify, so the
      // row never renders still-streaming with its reply gone
      working = null
      cancelAnimationFrame(frame)
      frame = 0
      setTimeout(publish, 0)
      // the refetch recomputes where the truncation marker sits now that the
      // turn is in the history
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(conversationId) })
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
    })
    return () => {
      offPart()
      offStats()
      offDone()
      working = null
      publish()
    }
  }, [queryClient])

  return {
    startReply: (conversationId, replyId) => {
      if (lastSettled?.id === replyId) return
      working = emptyReply(conversationId)
      publish()
    }
  }
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

// ---------- proposals ----------

/** what a budget or goal change touches, beyond the chat itself */
const PROPOSAL_EFFECTS: Record<Exclude<Proposal['kind'], 'recategorize'>, string[][]> = {
  set_budget: [['budget-summary'], ['reports'], ['report'], ['actionLog']],
  update_goal: [['goals'], ['reports'], ['report'], ['actionLog']]
}

/**
 * Put the message the proposal IPC returned into the thread, then refresh what
 * the change touched. A recategorize reaches everything a category edit does
 * (transaction tables, totals, budgets, reports), so like a category edit it
 * refreshes every query but the chat's own.
 */
function applyProposalResult(
  queryClient: QueryClient,
  message: ChatMessage,
  kind: Proposal['kind']
): void {
  queryClient.setQueryData<ConversationMessages>(chatMessagesKey(message.conversationId), (prev) =>
    prev
      ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) }
      : prev
  )
  if (kind === 'recategorize') {
    void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'chat' })
    return
  }
  for (const queryKey of PROPOSAL_EFFECTS[kind]) void queryClient.invalidateQueries({ queryKey })
}

/** Apply or dismiss a proposal; the returned message carries its new state. */
export function useResolveProposal(kind: Proposal['kind']) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ResolveProposalInput) => window.api.chat.resolveProposal(input),
    onSuccess: (message) => applyProposalResult(queryClient, message, kind),
    onError: (error) => toast(ipcErrorMessage(error))
  })
}

/** Revert an applied proposal through its action-log entry. */
export function useUndoProposal(kind: Proposal['kind']) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UndoProposalInput) => window.api.chat.undoProposal(input),
    onSuccess: (message) => applyProposalResult(queryClient, message, kind),
    onError: (error) => toast(ipcErrorMessage(error))
  })
}
