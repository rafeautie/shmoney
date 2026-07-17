import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, BubbleChatIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { useMessages, type ActiveReply } from '@/lib/chat'
import { ChatMessageRow } from '@/components/chat/chat-message-row'
import { StreamingReply } from '@/components/chat/streaming-reply'
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
  const streaming = reply !== null && reply.conversationId === conversationId

  // scroll-behavior: smooth would animate the mount-time jump to
  // defaultScrollPosition (the scroller asks for behavior 'auto', which defers
  // to the CSS), so the class waits a frame after the first messages land.
  // Deriving it from the current id rather than a plain boolean means it falls
  // back off when the conversation switches, ahead of the next one's jump.
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
        <MessageScrollerViewport className={cn(smoothFor === conversationId && 'scroll-smooth')}>
          <MessageScrollerContent className="mx-auto w-full max-w-2xl p-4">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={String(message.id)}
                scrollAnchor={message.role === 'user'}
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
                {message.status === 'streaming' ? (
                  <StreamingReply reply={streaming ? reply : null} modelLoading={modelLoading} />
                ) : (
                  <ChatMessageRow message={message} />
                )}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
