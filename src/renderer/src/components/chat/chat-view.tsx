import { HugeiconsIcon } from '@hugeicons/react'
import { BubbleChatIcon } from '@hugeicons/core-free-icons'
import { messageText, type ChatMessage } from '@shared/chat'
import { useMessages } from '@/lib/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'

/** The streamed reply so far; empty text = still waiting for the first token. */
export interface ActiveReply {
  conversationId: number
  text: string
}

export function ChatView({
  conversationId,
  reply
}: {
  conversationId: number | null
  reply: ActiveReply | null
}) {
  const messages = useMessages(conversationId).data ?? []
  const streaming = reply !== null && reply.conversationId === conversationId

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
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl p-4">
            {messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={String(message.id)}>
                <ChatMessageRow message={message} />
              </MessageScrollerItem>
            ))}
            {streaming && (
              <MessageScrollerItem messageId="streaming">
                {reply.text ? (
                  <AssistantBubble text={reply.text} />
                ) : (
                  <Marker>
                    <MarkerContent className="shimmer">Thinking…</MarkerContent>
                  </Marker>
                )}
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  const text = messageText(message)

  if (message.role === 'user') {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end">
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  if (message.status === 'error') {
    return (
      <Message>
        <MessageContent>
          <Bubble variant="destructive">
            <BubbleContent>{message.errorMessage ?? 'Something went wrong.'}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message>
      <MessageContent>
        <AssistantBubble text={text} />
        {message.status === 'interrupted' && <MessageFooter>Stopped generating</MessageFooter>}
      </MessageContent>
    </Message>
  )
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <Bubble variant="ghost">
      <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
    </Bubble>
  )
}
