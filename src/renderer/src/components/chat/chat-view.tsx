import type { ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  BubbleChatIcon,
  Loading03Icon,
  SparklesIcon
} from '@hugeicons/core-free-icons'
import { Streamdown } from 'streamdown'
import {
  messageReasoning,
  messageText,
  type ChatMessage,
  type ChatMessagePart,
  type QueryToolResult
} from '@shared/chat'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { ChatTable } from '@/components/chat/chat-table'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { QueryCard } from '@/components/chat/query-card'
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

/** One in-flight query tool call, keyed by callId within the streaming reply. */
export interface ActiveToolCall {
  callId: number
  /** raw params JSON streamed so far; sql derives from it until start supplies the real one */
  paramsText: string
  sql: string
  status: 'writing' | 'running' | 'done'
  result: QueryToolResult | null
}

/** The streamed reply so far; all-empty = still waiting for the first token. */
export interface ActiveReply {
  conversationId: number
  text: string
  /** the chain of thought streamed so far ('' when the model isn't thinking) */
  reasoning: string
  /** when the first reasoning chunk arrived; drives the live duration */
  reasoningStartedAt: number | null
  /** frozen once the answer (or a tool call) starts; the persisted row's value replaces it */
  reasoningMs: number | null
  /** query tool calls streamed so far, in call order */
  toolCalls: ActiveToolCall[]
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
  const { messages, truncatedBeforeId } = useMessages(conversationId).data ?? {
    messages: [],
    truncatedBeforeId: null
  }
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
    // keyed per conversation so each one opens at its default scroll position
    // (the scroller applies it once per mount)
    <MessageScrollerProvider key={conversationId} defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-2xl p-4">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={String(message.id)}
                scrollAnchor={message.role === 'user'}
              >
                {message.id === truncatedBeforeId && (
                  <Marker variant="separator" role="separator" className="my-2">
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

/**
 * The in-flight reply, rendered from streamed state into the placeholder
 * row's item — the settled parts later render in the same spot, so the
 * scroller never sees an element swap. A null reply (a conversation reopened
 * mid-turn) shows the waiting marker until the next chunk arrives.
 */
function StreamingReply({
  reply,
  modelLoading
}: {
  reply: ActiveReply | null
  modelLoading: boolean
}) {
  if (reply && (reply.text || reply.reasoning || reply.toolCalls.length > 0)) {
    return (
      // keyed remounts fade each marker state in gently: waiting marker →
      // first content, and the label flips inside
      <Message className="animate-in fade-in-0 duration-300">
        <MessageContent>
          {reply.reasoning && (
            <ReasoningBlock
              text={reply.reasoning}
              durationMs={reply.reasoningMs}
              thinking={!reply.text && reply.toolCalls.length === 0}
            />
          )}
          {reply.toolCalls.map((call) => (
            <QueryCard
              key={call.callId}
              state={
                call.status === 'done' && call.result !== null
                  ? { status: 'done', sql: call.sql, result: call.result }
                  : { status: call.status === 'running' ? 'running' : 'writing', sql: call.sql }
              }
            />
          ))}
          {reply.text && <AssistantBubble text={reply.text} isStreaming />}
        </MessageContent>
      </Message>
    )
  }
  return (
    // the fade lives on a wrapper because animate-in and the marker's own
    // animate-shimmer would fight over `animation`
    <div key={modelLoading ? 'loading' : 'thinking'} className="animate-in fade-in-0 duration-300">
      <Marker role="status" className="w-fit animate-shimmer">
        <MarkerIcon>
          {modelLoading ? (
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
          ) : (
            <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />
          )}
        </MarkerIcon>
        <MarkerContent>{modelLoading ? 'Loading model…' : 'Thinking…'}</MarkerContent>
      </Marker>
    </div>
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
  const calls = message.parts.filter(
    (p): p is Extract<ChatMessagePart, { type: 'functionCall' }> => p.type === 'functionCall'
  )
  return (
    <Message>
      <MessageContent>
        {reasoning && <ReasoningBlock text={reasoning.text} durationMs={reasoning.durationMs} />}
        {calls.map((call, i) => (
          <QueryCard key={i} state={{ status: 'done', sql: call.args.sql, result: call.result }} />
        ))}
        {/* a turn stopped mid-query can have cards but no answer; skip the empty bubble then */}
        {(text || calls.length === 0) && <AssistantBubble text={text} />}
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
        <span key={thinking ? 'thinking' : 'thought'} className="animate-in fade-in-0 duration-300">
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

// markdown tables render through the same shell as query results (height cap,
// sticky header, copy/download) with plain cell elements, so both kinds of
// table look identical; ChatTableViewport owns the one canonical table style
const streamdownComponents: ComponentProps<typeof Streamdown>['components'] = {
  table: ({ node: _node, children, ...props }) => (
    <ChatTable className="my-2">
      <table {...props}>{children}</table>
    </ChatTable>
  ),
  thead: ({ node: _node, children, ...props }) => <thead {...props}>{children}</thead>,
  tbody: ({ node: _node, children, ...props }) => <tbody {...props}>{children}</tbody>,
  tr: ({ node: _node, children, ...props }) => <tr {...props}>{children}</tr>,
  th: ({ node: _node, children, ...props }) => <th {...props}>{children}</th>,
  td: ({ node: _node, children, ...props }) => <td {...props}>{children}</td>
}

function AssistantBubble({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
  return (
    // full width (not the default shrink-wrap) so markdown tables span the column
    <Bubble variant="ghost" className="w-full">
      <BubbleContent className="w-full">
        <Streamdown
          mode={isStreaming ? 'streaming' : 'static'}
          isAnimating={isStreaming}
          components={streamdownComponents}
        >
          {text}
        </Streamdown>
      </BubbleContent>
    </Bubble>
  )
}
