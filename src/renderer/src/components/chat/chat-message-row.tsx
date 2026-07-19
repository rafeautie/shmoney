import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { messageText, type ChatMessage, type StreamingChatPart } from '@shared/chat'
import type { ActiveReply } from '@/lib/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ChartCard } from '@/components/chat/chat-chart'
import { QueryCard } from '@/components/chat/query-card'
import { ThoughtChain } from '@/components/chat/thought-chain'

/**
 * An assistant turn's parts, strictly in order, nothing held back: chains of
 * thought, preamble text, tool cards, charts and answer text exactly as they
 * were generated. Streaming and settled rows render the same parts through
 * this same mapping — a streamed part IS the persisted part (or its pending
 * form), so a landing turn cannot visibly change. The streaming flag drives
 * only the trailing text's caret; "active" states derive from the pending
 * forms themselves (a thought with no duration, a call with no result). asOf
 * is the turn's age, carried here rather than on each chart because it
 * belongs to the message.
 */
function Parts({
  parts,
  streaming,
  asOf
}: {
  parts: StreamingChatPart[]
  streaming: boolean
  /** unix ms the turn was generated; absent while it streams (it's live) */
  asOf?: number
}) {
  const lastIndex = parts.length - 1
  return parts.map((part, i) => {
    switch (part.type) {
      case 'text':
        return (
          <AssistantBubble key={i} text={part.text} isStreaming={streaming && i === lastIndex} />
        )
      case 'reasoning':
        return (
          <ThoughtChain
            key={i}
            reasoning={{ text: part.text, durationMs: part.durationMs }}
            active={part.durationMs === null}
          />
        )
      case 'functionCall':
        // pending: the model is still writing this call's params
        if (part.result === undefined)
          return part.name === 'chart' ? <ChartCard key={i} /> : <QueryCard key={i} />
        if (part.name === 'chart')
          return (
            <ChartCard
              key={i}
              spec={part.args}
              result={part.result}
              display={part.display}
              asOf={asOf}
            />
          )
        if (part.name === 'query')
          return <QueryCard key={i} sql={part.args.sql} result={part.result} />
        // a shape this build doesn't know, e.g. a row written before the
        // formats merged; skipping beats guessing which tool it was
        return null
    }
  })
}

/** The turn is accepted but nothing has streamed yet. */
function WaitingMarker({ modelLoading }: { modelLoading: boolean }) {
  return (
    // keyed remounts fade each marker state in gently: waiting marker →
    // first content, and the label flips inside. The fade lives on a wrapper
    // because animate-in and the marker's own animate-shimmer would fight over
    // `animation`
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

/**
 * One message row: a user bubble, an error bubble, or an assistant turn. The
 * same component renders a turn live and settled; it takes its items from the
 * streamed reply while the row is streaming and from the persisted parts after,
 * so React never tears the subtree down on settle and the cards keep whatever
 * the user opened mid-reply.
 */
export function ChatMessageRow({
  message,
  reply,
  modelLoading = false
}: {
  message: ChatMessage
  /** the streamed reply, passed only while this row is the streaming one */
  reply?: ActiveReply | null
  /** the model is loading into memory; the waiting marker says so */
  modelLoading?: boolean
}) {
  if (message.role === 'user') {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end">
            <BubbleContent className="whitespace-pre-wrap">{messageText(message)}</BubbleContent>
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

  const streaming = message.status === 'streaming'
  // a null reply is a conversation reopened mid-turn: nothing streamed here
  // yet, so the row waits like it does before the first chunk. The streamed
  // array can be momentarily sparse after such a reopen, so holes are dropped
  const parts = streaming
    ? (reply?.parts ?? []).filter((part) => part !== undefined)
    : message.parts

  if (streaming && parts.length === 0) return <WaitingMarker modelLoading={modelLoading} />

  return (
    // the fade-in only runs on mount, i.e. when the first part replaces the
    // waiting marker; dropping the class on settle removes an animation rather
    // than starting one, so a landing turn doesn't flash
    <Message className={streaming ? 'animate-in fade-in-0 duration-300' : undefined}>
      <MessageContent>
        <Parts parts={parts} streaming={streaming} asOf={message.createdAt} />
        {message.status === 'interrupted' && <MessageFooter>Stopped generating</MessageFooter>}
      </MessageContent>
    </Message>
  )
}
