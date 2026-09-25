import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Target02Icon } from '@hugeicons/core-free-icons'
import { messageText, type ChatMessage, type StreamingChatPart } from '@shared/chat'
import type { ActiveReply } from '@/lib/chat'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ThoughtChain, type ChainPart } from '@/components/chat/thought-chain'

/**
 * An assistant turn's parts, strictly in order, nothing held back: chains of
 * thought, preamble text, tool calls, charts and answer text exactly as they
 * were generated. Streaming and settled rows render the same parts through
 * this same mapping — a streamed part IS the persisted part (or its pending
 * form), so a landing turn cannot visibly change. The streaming flag marks the
 * live, still-growing run (and the trailing text's caret); within a run,
 * "active" states derive from the pending forms themselves (a thought with no
 * duration, a call with no result). asOf is the turn's age, carried here rather
 * than on each chart because it belongs to the message.
 *
 * A turn's reasoning and tool calls collapse into one ThoughtChain — a single
 * chain of thought — rather than stacking as separate panels and cards. A run
 * is broken only by text (the answer), so interleaved thinking never splits the
 * tool calls into two summaries. Only the last run of a streaming turn is live;
 * a run the answer already closed off shows its settled summary.
 */
function Parts({
  parts,
  streaming,
  asOf,
  messageId
}: {
  parts: StreamingChatPart[]
  streaming: boolean
  /** unix ms the turn was generated; absent while it streams (it's live) */
  asOf?: number
  /** the message the parts belong to, once it's settled; proposals address it */
  messageId?: number
}) {
  // nothing streamed yet: an empty live chain is the waiting status line, keyed
  // as the first run's chain so a leading thought takes it over in place
  if (streaming && parts.length === 0) return [<ThoughtChain key="chain-0" parts={[]} streaming />]

  const lastIndex = parts.length - 1
  const nodes: ReactNode[] = []
  let run: ChainPart[] = []
  let runStart = 0
  // a run closed off by answer text is complete (live = false); only the
  // trailing run of a streaming turn is still growing
  const flushRun = (live: boolean) => {
    if (run.length === 0) return
    nodes.push(
      <ThoughtChain
        key={`chain-${runStart}`}
        parts={run}
        streaming={live}
        asOf={asOf}
        messageId={messageId}
        startIndex={runStart}
      />
    )
    run = []
  }
  parts.forEach((part, i) => {
    if (part.type === 'text') {
      flushRun(false)
      nodes.push(
        <AssistantBubble key={i} text={part.text} isStreaming={streaming && i === lastIndex} />
      )
      return
    }
    // reasoning or a tool call: both are steps of the same chain of thought
    if (run.length === 0) runStart = i
    run.push(part)
  })
  flushRun(streaming)
  return nodes
}

// decided off the tools the turn ran (for SQL, the tables it named), so nothing
// new has to be kept in step; a loose match costs a spare link, never a wrong number
const GOAL_QUERY = /\bgoals\b|\bgoal_history\b/i

function queriedGoals(parts: StreamingChatPart[]): boolean {
  return parts.some((part) => {
    if (part.type !== 'functionCall' || !part.args) return false
    switch (part.name) {
      case 'query':
        return GOAL_QUERY.test(part.args.sql)
      case 'goals':
      case 'update_goal':
        return true
      case 'what_if':
        return part.args.goal != null
      default:
        return false
    }
  })
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

  return (
    // the fade-in only runs on mount, i.e. when the turn is accepted; dropping
    // the class on settle removes an animation rather than starting one, so a
    // landing turn doesn't flash
    <Message className={streaming ? 'animate-in fade-in-0 duration-300' : undefined}>
      <MessageContent>
        <Parts
          parts={parts}
          streaming={streaming}
          asOf={message.createdAt}
          messageId={streaming ? undefined : message.id}
        />
        {!streaming && queriedGoals(parts) && (
          <Badge
            variant="outline"
            className="gap-1"
            render={<Link to="/goals" aria-label="Open Goals" />}
          >
            <HugeiconsIcon icon={Target02Icon} strokeWidth={2} data-icon="inline-start" />
            Goals
          </Badge>
        )}
        {message.status === 'interrupted' && <MessageFooter>Stopped generating</MessageFooter>}
      </MessageContent>
    </Message>
  )
}
