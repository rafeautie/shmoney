import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import type { ActiveReply, ActiveToolCall } from '@/lib/chat'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ChartBuilding, ChartFailure, ChatChart } from '@/components/chat/chat-chart'
import { QueryCard, type QueryCardState } from '@/components/chat/query-card'
import { ThoughtChain } from '@/components/chat/thought-chain'

function toQueryCardState(call: ActiveToolCall): QueryCardState {
  return call.status === 'done' && call.result !== null
    ? { status: 'done', sql: call.sql, result: call.result }
    : { status: call.status === 'running' ? 'running' : 'writing', sql: call.sql }
}

/** One in-flight chart call: building marker, the chart, or its failure. */
function ChartCallView({ call }: { call: ActiveToolCall }) {
  if (call.status !== 'done') return <ChartBuilding />
  if (call.chart)
    return (
      <ChatChart spec={call.chart.spec} data={call.chart.data} currency={call.chart.currency} />
    )
  return <ChartFailure error={call.chartError ?? 'Chart failed.'} />
}

/**
 * The in-flight reply, rendered from streamed state into the placeholder
 * row's item — the settled parts later render in the same spot, so the
 * scroller never sees an element swap. Items render strictly in arrival
 * order (preamble text, tool cards, charts, answer text), mirroring how the
 * settled parts will. A null reply (a conversation reopened mid-turn) shows
 * the waiting marker until the next chunk arrives.
 */
export function StreamingReply({
  reply,
  modelLoading
}: {
  reply: ActiveReply | null
  /** the model is loading into memory; the waiting marker says so */
  modelLoading: boolean
}) {
  if (reply && (reply.reasoning || reply.items.length > 0)) {
    // the thinking phase ends (and the chain collapses) once the first answer
    // token or tool call arrives — that's when reasoningMs freezes
    const thinking = reply.reasoning !== '' && reply.reasoningMs === null
    const lastIndex = reply.items.length - 1
    return (
      // keyed remounts fade each marker state in gently: waiting marker →
      // first content, and the label flips inside
      <Message className="animate-in fade-in-0 duration-300">
        <MessageContent>
          <ThoughtChain
            reasoning={
              reply.reasoning ? { text: reply.reasoning, durationMs: reply.reasoningMs } : null
            }
            active={thinking}
          />
          {reply.items.map((item, i) =>
            item.kind === 'text' ? (
              item.text && (
                <AssistantBubble key={i} text={item.text} isStreaming={i === lastIndex} />
              )
            ) : item.call.name === 'chart' ? (
              <ChartCallView key={i} call={item.call} />
            ) : (
              <QueryCard key={i} state={toQueryCardState(item.call)} />
            )
          )}
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
