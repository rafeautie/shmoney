import { messageReasoning, messageText, type ChatMessage, type ChatMessagePart } from '@shared/chat'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { AssistantBubble } from '@/components/chat/assistant-bubble'
import { ThoughtChain } from '@/components/chat/thought-chain'

/** One settled message: a user bubble, an error bubble, or an assistant turn. */
export function ChatMessageRow({ message }: { message: ChatMessage }) {
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
