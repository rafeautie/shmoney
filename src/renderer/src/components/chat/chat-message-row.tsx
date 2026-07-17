import { messageReasoning, messageText, type ChatMessage } from '@shared/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ChartFailure, ChatChart } from '@/components/chat/chat-chart'
import { QueryCard } from '@/components/chat/query-card'
import { ThoughtChain } from '@/components/chat/thought-chain'

/** One settled message: a user bubble, an error bubble, or an assistant turn. */
export function ChatMessageRow({ message }: { message: ChatMessage }) {
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

  // an assistant turn renders its parts strictly in persisted order — the
  // chain of thought leads, then preamble text, tool cards, charts and answer
  // text exactly as they were generated
  return (
    <Message>
      <MessageContent>
        <ThoughtChain reasoning={messageReasoning(message)} active={false} />
        {message.parts.map((part, i) => {
          if (part.type === 'text')
            return part.text ? <AssistantBubble key={i} text={part.text} /> : null
          if (part.type === 'functionCall')
            return (
              <QueryCard
                key={i}
                state={{ status: 'done', sql: part.args.sql, result: part.result }}
              />
            )
          if (part.type === 'chart')
            return part.data ? (
              <ChatChart
                key={i}
                spec={part.spec}
                data={part.data}
                currency={part.currency}
                asOf={message.createdAt}
              />
            ) : (
              <ChartFailure key={i} error={part.error ?? 'Chart failed.'} />
            )
          return null // reasoning renders above, as the chain
        })}
        {message.status === 'interrupted' && <MessageFooter>Stopped generating</MessageFooter>}
      </MessageContent>
    </Message>
  )
}
