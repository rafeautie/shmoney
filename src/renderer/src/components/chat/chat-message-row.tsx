import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { messageText, type ChatMessage, type StreamingChatPart } from '@shared/chat'
import type { ActiveReply } from '@/lib/chat'
import { useLlmStatus } from '@/lib/llm'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ThoughtChain, type ChainPart } from '@/components/chat/thought-chain'

/**
 * An assistant turn's parts, strictly in order, nothing held back: chains of
 * thought, preamble text, tool calls, charts and answer text exactly as they
 * were generated. Streaming and settled rows render the same parts through
 * this same mapping — a streamed part IS the persisted part (or its pending
 * form), so a landing turn cannot visibly change. The streaming flag drives
 * only the trailing text's caret; "active" states derive from the pending
 * forms themselves (a thought with no duration, a call with no result). asOf
 * is the turn's age, carried here rather than on each chart because it
 * belongs to the message.
 *
 * A turn's reasoning and tool calls collapse into one ThoughtChain — a single
 * chain of thought — rather than stacking as separate panels and cards. A run
 * is broken only by text (the answer), so interleaved thinking never splits the
 * tool calls into two summaries.
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
  const nodes: ReactNode[] = []
  let run: ChainPart[] = []
  let runStart = 0
  const flushRun = () => {
    if (run.length === 0) return
    nodes.push(<ThoughtChain key={`chain-${runStart}`} parts={run} asOf={asOf} />)
    run = []
  }
  parts.forEach((part, i) => {
    if (part.type === 'text') {
      flushRun()
      nodes.push(
        <AssistantBubble key={i} text={part.text} isStreaming={streaming && i === lastIndex} />
      )
      return
    }
    // reasoning or a tool call: both are steps of the same chain of thought
    if (run.length === 0) runStart = i
    run.push(part)
  })
  flushRun()
  return nodes
}

/** The turn is accepted but nothing has streamed yet. */
function WaitingMarker() {
  // While a waiting turn has no chunk yet, the model is "loading" whenever it
  // isn't confirmed in memory — not only during the brief 'loading' window.
  // The status push that flips 'downloaded'→'loading' lands a beat after the
  // turn starts, so gating on 'loading' alone would flash "Thinking…" for that
  // beat before "Loading model…". Reading live status here (as LlmStatusBadge
  // does) keeps this in step with the worker without prop drilling.
  const loading = useLlmStatus().data?.runtime !== 'ready'
  return (
    // keyed remounts fade each marker state in gently: waiting marker →
    // first content, and the label flips inside. The fade lives on a wrapper
    // because animate-in and the marker's own animate-shimmer would fight over
    // `animation`
    <div key={loading ? 'loading' : 'thinking'} className="animate-in fade-in-0 duration-300">
      <Marker role="status" className="w-fit animate-shimmer">
        <MarkerIcon>
          {loading ? (
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
          ) : (
            <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />
          )}
        </MarkerIcon>
        <MarkerContent>{loading ? 'Loading model…' : 'Thinking…'}</MarkerContent>
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
  reply
}: {
  message: ChatMessage
  /** the streamed reply, passed only while this row is the streaming one */
  reply?: ActiveReply | null
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

  if (streaming && parts.length === 0) return <WaitingMarker />

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
