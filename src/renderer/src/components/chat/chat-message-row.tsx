import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { messageText, type ChatMessage, type ChatMessagePart } from '@shared/chat'
import type { ActiveReply, TurnItem } from '@/lib/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ChartCard } from '@/components/chat/chat-chart'
import { QueryCard } from '@/components/chat/query-card'
import { ThoughtChain } from '@/components/chat/thought-chain'

/** The persisted parts as turn items; every call is settled by definition. */
function settledTurnItems(parts: ChatMessagePart[]): TurnItem[] {
  const turnItems: TurnItem[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      turnItems.push({ kind: 'text', text: part.text })
    } else if (part.type === 'reasoning') {
      turnItems.push({ kind: 'reasoning', text: part.text, durationMs: part.durationMs })
    } else if (part.name === 'chart') {
      turnItems.push({
        kind: 'chart',
        state: {
          status: 'done',
          spec: part.args,
          display: part.display,
          error: part.result.error
        }
      })
    } else if (part.name === 'query') {
      turnItems.push({
        kind: 'query',
        state: { status: 'done', sql: part.args.sql, result: part.result }
      })
    }
    // any other part is a shape this build doesn't know, such as a row written
    // before the chart and query formats merged. Skipping it beats matching by
    // elimination, which would read it as whichever tool the last branch names
  }
  return turnItems
}

/**
 * An assistant turn's items, strictly in order, nothing held back: chains of
 * thought, preamble text, tool cards, charts and answer text exactly as they
 * were generated. A turn that thought more than once therefore shows a chain
 * at each spot it thought. The streaming flag drives only the trailing text's
 * caret; everything else renders the same live and settled, which is what
 * keeps a turn from visibly changing as it lands. asOf is the turn's age,
 * carried here rather than on each chart because it belongs to the message.
 */
function TurnItems({
  items,
  streaming,
  asOf
}: {
  items: TurnItem[]
  streaming: boolean
  /** unix ms the turn was generated; absent while it streams (it's live) */
  asOf?: number
}) {
  const lastIndex = items.length - 1
  return items.map((item, i) => {
    switch (item.kind) {
      case 'text':
        return (
          <AssistantBubble key={i} text={item.text} isStreaming={streaming && i === lastIndex} />
        )
      case 'reasoning':
        return (
          <ThoughtChain
            key={i}
            reasoning={{ text: item.text, durationMs: item.durationMs }}
            // a thought is still being written exactly while its duration
            // hasn't frozen; deriving that from the item rather than from its
            // position keeps it right when the model emits a thought, then
            // formatting whitespace, then thinks again
            active={item.durationMs === null}
          />
        )
      case 'query':
        return <QueryCard key={i} state={item.state} />
      case 'chart':
        return <ChartCard key={i} state={item.state} asOf={asOf} />
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
  // yet, so the row waits like it does before the first chunk. Neither source
  // carries an item that renders nothing; both drop them as they're produced
  const items = streaming ? (reply?.items ?? []) : settledTurnItems(message.parts)

  if (streaming && items.length === 0) return <WaitingMarker modelLoading={modelLoading} />

  return (
    // the fade-in only runs on mount, i.e. when the first item replaces the
    // waiting marker; dropping the class on settle removes an animation rather
    // than starting one, so a landing turn doesn't flash
    <Message className={streaming ? 'animate-in fade-in-0 duration-300' : undefined}>
      <MessageContent>
        <TurnItems items={items} streaming={streaming} asOf={message.createdAt} />
        {message.status === 'interrupted' && <MessageFooter>Stopped generating</MessageFooter>}
      </MessageContent>
    </Message>
  )
}
