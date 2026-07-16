import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  BubbleChatIcon,
  Loading03Icon,
  SparklesIcon
} from '@hugeicons/core-free-icons'
import { Streamdown } from 'streamdown'
import { messageReasoning, messageText, type ChatMessage } from '@shared/chat'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'

/** The streamed reply so far; all-empty = still waiting for the first token. */
export interface ActiveReply {
  conversationId: number
  text: string
  /** the chain of thought streamed so far ('' when the model isn't thinking) */
  reasoning: string
  /** when the first reasoning chunk arrived; drives the live duration */
  reasoningStartedAt: number | null
  /** frozen once the answer starts; the persisted row's value replaces it */
  reasoningMs: number | null
}

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
    <MessageScrollerProvider defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-2xl p-4">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={String(message.id)}
                scrollAnchor={message.role === 'assistant'}
              >
                <ChatMessageRow message={message} />
              </MessageScrollerItem>
            ))}
            {streaming && (
              <MessageScrollerItem messageId="streaming">
                {reply.text || reply.reasoning ? (
                  <Message>
                    <MessageContent>
                      {reply.reasoning && (
                        <ReasoningBlock
                          text={reply.reasoning}
                          durationMs={reply.reasoningMs}
                          thinking={!reply.text}
                        />
                      )}
                      {reply.text && <AssistantBubble text={reply.text} isStreaming />}
                    </MessageContent>
                  </Message>
                ) : (
                  <Marker role="status" className="w-fit animate-shimmer">
                    <MarkerIcon>
                      {modelLoading ? (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          strokeWidth={2}
                          className="animate-spin"
                        />
                      ) : (
                        <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />
                      )}
                    </MarkerIcon>
                    <MarkerContent>{modelLoading ? 'Loading model…' : 'Thinking…'}</MarkerContent>
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

  const reasoning = messageReasoning(message)
  return (
    <Message>
      <MessageContent>
        {reasoning && <ReasoningBlock text={reasoning.text} durationMs={reasoning.durationMs} />}
        <AssistantBubble text={text} />
        {message.status === 'interrupted' && <MessageFooter>Stopped generating</MessageFooter>}
      </MessageContent>
    </Message>
  )
}

/** "12s" or "1m 5s"; sub-second thoughts round up so the label never says 0s */
function formatThoughtDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * The model's chain of thought: a "Thinking…" / "Thought for Ns" label that
 * expands to the thought text. Collapsed by default so the answer stays the
 * focus; expanding mid-turn shows the thought streaming live.
 */
function ReasoningBlock({
  text,
  durationMs,
  thinking = false
}: {
  text: string
  durationMs: number | null
  thinking?: boolean
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          'group/reasoning flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
          thinking && 'animate-shimmer'
        )}
      >
        <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-3.5" />
        <span>
          {thinking ? 'Thinking…' : `Thought for ${formatThoughtDuration(durationMs ?? 0)}`}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-3.5 transition-transform group-data-panel-open/reasoning:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 border-l-2 border-border pl-3 text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AssistantBubble({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
  return (
    <Bubble variant="ghost">
      <BubbleContent>
        <Streamdown mode={isStreaming ? 'streaming' : 'static'} isAnimating={isStreaming}>
          {text}
        </Streamdown>
      </BubbleContent>
    </Bubble>
  )
}
