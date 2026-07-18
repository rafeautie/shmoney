import { useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, BubbleChatIcon, Wallet01Icon } from '@hugeicons/core-free-icons'
import type { ChatMessage, ChatTurnScope } from '@shared/chat'
import { cn } from '@/lib/utils'
import { useMessages, type ActiveReply } from '@/lib/chat'
import { ChatMessageRow } from '@/components/chat/chat-message-row'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'

/**
 * Where the recorded turn scope changes, keyed by the message id the marker
 * renders above (the turn's user row when present, so the divider sits ahead
 * of the whole exchange). The first recorded scope gets a marker only when
 * narrowed — all-accounts is the default a transcript is read under. Rows
 * predating scope recording carry null and neither draw nor reset markers.
 */
function scopeMarkers(messages: ChatMessage[]): Map<number, string> {
  const markers = new Map<number, string>()
  let previous: ChatTurnScope | null = null
  messages.forEach((message, i) => {
    if (message.role !== 'assistant' || !message.scope) return
    const scope = message.scope
    const changed =
      previous === null ? scope.accountId !== null : previous.accountId !== scope.accountId
    if (changed) {
      const anchor = messages[i - 1]?.role === 'user' ? messages[i - 1] : message
      markers.set(
        anchor.id,
        scope.accountName ? `Narrowed to ${scope.accountName}` : 'All accounts'
      )
    }
    previous = scope
  })
  return markers
}

/** The transcript: the conversation's messages with the in-flight reply streaming in place. */
export function ChatView({
  conversationId,
  reply,
  modelLoading = false
}: {
  conversationId: number | null
  reply: ActiveReply | null
  /** the model is loading into memory; the waiting marker says so */
  modelLoading?: boolean
}) {
  const { messages, truncatedBeforeId } = useMessages(conversationId).data ?? {
    messages: [],
    truncatedBeforeId: null
  }
  const markers = useMemo(() => scopeMarkers(messages), [messages])
  const streaming = reply !== null && reply.conversationId === conversationId

  // scroll-behavior: smooth would animate the mount-time jump to
  // defaultScrollPosition (the scroller asks for behavior 'auto', which defers
  // to the CSS), so the class waits a frame after the first messages land.
  // Deriving it from the current id rather than a plain boolean means it falls
  // back off when the conversation switches, ahead of the next one's jump.
  // It is also confined to the streaming window (see the viewport below): the
  // scroller re-anchors on every content resize while a turn is anchored, and
  // once the reply has settled the only resizes left are the user collapsing
  // cards — corrections there must be instant or they read as the transcript
  // scrolling itself.
  const [smoothFor, setSmoothFor] = useState<number | null>(null)
  const hasMessages = messages.length > 0
  useEffect(() => {
    if (conversationId === null || !hasMessages) return
    const frame = requestAnimationFrame(() => setSmoothFor(conversationId))
    return () => cancelAnimationFrame(frame)
  }, [conversationId, hasMessages])

  if (conversationId === null) {
    return (
      <Empty className="flex-1 border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={BubbleChatIcon} />
          </EmptyMedia>
          <EmptyTitle>Start a conversation</EmptyTitle>
          <EmptyDescription>
            Chat with the on-device model. Nothing you type leaves this computer.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    // keyed per conversation so each one opens at its default scroll position
    // (the scroller applies it once per mount)
    <MessageScrollerProvider key={conversationId} defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport
          className={cn(smoothFor === conversationId && streaming && 'scroll-smooth')}
        >
          <MessageScrollerContent className="mx-auto w-full max-w-2xl p-4">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={String(message.id)}
                // anchored only while a reply is streaming: the send-time pin
                // still engages (the reply is active in the commit that mounts
                // the new user row), but a settled conversation mounts with no
                // anchors — otherwise the scroller anchors the last user
                // message on mount and re-pins it on any content resize, so
                // collapsing a card would scroll the transcript on its own
                scrollAnchor={message.role === 'user' && streaming}
              >
                {message.id === truncatedBeforeId && (
                  // amber, not muted: this one changes what the model can see,
                  // so it has to read as a warning rather than a caption
                  <Marker
                    variant="separator"
                    role="separator"
                    className="my-2 text-amber-600 before:bg-amber-500/30 after:bg-amber-500/30 dark:text-amber-500"
                  >
                    <MarkerIcon>
                      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                    </MarkerIcon>
                    <MarkerContent>Older messages aren&apos;t sent to the model</MarkerContent>
                  </Marker>
                )}
                {markers.has(message.id) && (
                  // default muted styling: a scope change is context, not a
                  // warning — everything below ran under this scope
                  <Marker variant="separator" role="separator" className="my-2">
                    <MarkerIcon>
                      <HugeiconsIcon icon={Wallet01Icon} strokeWidth={2} />
                    </MarkerIcon>
                    <MarkerContent>{markers.get(message.id)}</MarkerContent>
                  </Marker>
                )}
                {/* one component type for every row, streaming or not: a
                    settling turn keeps its instance, so the cards the user
                    opened mid-reply don't snap shut when it lands */}
                <ChatMessageRow
                  message={message}
                  reply={streaming ? reply : null}
                  modelLoading={modelLoading}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
