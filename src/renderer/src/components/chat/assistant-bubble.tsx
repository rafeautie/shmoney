import type { ComponentProps } from 'react'
import { Streamdown } from 'streamdown'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { ChatTable } from '@/components/chat/chat-table'

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

/** An assistant answer as Markdown, streaming-aware via streamdown. */
export function AssistantBubble({
  text,
  isStreaming = false
}: {
  text: string
  isStreaming?: boolean
}) {
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
