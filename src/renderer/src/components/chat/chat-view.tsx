import { useEffect, useState, type ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  BubbleChatIcon,
  DatabaseIcon,
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
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep
} from '@/components/ui/chain-of-thought'
import { ChatTable } from '@/components/chat/chat-table'
import { QueryCard, type QueryCardState } from '@/components/chat/query-card'
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
          <ThoughtChain
            reasoning={
              reply.reasoning ? { text: reply.reasoning, durationMs: reply.reasoningMs } : null
            }
            calls={reply.toolCalls.map(toQueryCardState)}
            active={!reply.text}
          />
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
        <ThoughtChain
          reasoning={reasoning}
          calls={calls.map((call) => ({
            status: 'done',
            sql: call.args.sql,
            result: call.result
          }))}
          active={false}
        />
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

function toQueryCardState(call: ActiveToolCall): QueryCardState {
  return call.status === 'done' && call.result !== null
    ? { status: 'done', sql: call.sql, result: call.result }
    : { status: call.status === 'running' ? 'running' : 'writing', sql: call.sql }
}

/** "Thought for 12s · 2 queries" — what the settled chain collapses to */
function chainLabel(reasoning: Reasoning | null, callCount: number): string {
  const parts: string[] = []
  if (reasoning) parts.push(`Thought for ${formatThoughtDuration(reasoning.durationMs ?? 0)}`)
  if (callCount > 0) parts.push(`${callCount} ${callCount === 1 ? 'query' : 'queries'}`)
  return parts.join(' · ')
}

interface Reasoning {
  text: string
  durationMs: number | null
}

/**
 * The turn's reasoning and query calls as one chain of thought: a timeline of
 * steps that stays open while the model works, then collapses to a summary
 * once the answer starts, so settled turns read as just the answer. The thought
 * itself sits open on the rail; only the query steps, which carry SQL and a
 * result table, are worth a toggle. The user's toggle always wins.
 */
function ThoughtChain({
  reasoning,
  calls,
  active
}: {
  reasoning: Reasoning | null
  calls: QueryCardState[]
  /** the turn is still working, so the chain stays expanded */
  active: boolean
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? active

  if (!reasoning && calls.length === 0) return null

  return (
    <ChainOfThought open={open} onOpenChange={setUserOpen}>
      <ChainOfThoughtHeader className={cn(active && 'animate-shimmer')}>
        {active ? 'Working…' : chainLabel(reasoning, calls.length)}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {reasoning && (
          // no icon: the header's brain already stands for the thought, and no
          // toggle either — the header summarises it, so a second one would
          // just be in the way
          <ChainOfThoughtStep>
            <div className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
              {reasoning.text}
            </div>
          </ChainOfThoughtStep>
        )}
        {calls.map((call, i) => (
          <ChainOfThoughtStep
            key={i}
            icon={DatabaseIcon}
            status={call.status === 'done' ? 'complete' : 'active'}
          >
            <QueryCard state={call} />
          </ChainOfThoughtStep>
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
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
