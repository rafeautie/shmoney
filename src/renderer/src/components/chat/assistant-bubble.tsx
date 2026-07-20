import type { ComponentProps } from 'react'
import { Streamdown, defaultRehypePlugins } from 'streamdown'
import { Amount } from '@/components/amount'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { ChatTable } from '@/components/chat/chat-table'
import { rehypeAmount } from '@/lib/rehype-amount'

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
  td: ({ node: _node, children, ...props }) => <td {...props}>{children}</td>,
  span: ({ node: _node, children, ...props }) => {
    const { 'data-amount': amount, 'data-currency': currency } = props as typeof props & {
      'data-amount'?: string
      'data-currency'?: string
    }
    if (amount === undefined) return <span {...props}>{children}</span>
    // inline-block + clip-path keep the privacy blur inside the amount's own
    // box: unclipped, the halo bleeds into neighboring prose and the line box
    // crops it at the top
    return (
      <Amount
        value={Math.round(Number(amount) * 1000)}
        currency={String(currency)}
        colored={false}
        className="inline-block"
        blurClassName="[clip-path:inset(1px_round_9999px)]"
      />
    )
  }
}

// passing rehypePlugins REPLACES streamdown's defaults, so spread them back in
// (keeping sanitize/harden) and run the amount plugin last, post-sanitize
const rehypePlugins = [...Object.values(defaultRehypePlugins), rehypeAmount]

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
          rehypePlugins={rehypePlugins}
        >
          {text}
        </Streamdown>
      </BubbleContent>
    </Bubble>
  )
}
