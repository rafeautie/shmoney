import type { ComponentProps, CSSProperties } from 'react'
import { Streamdown, defaultRehypePlugins } from 'streamdown'
import { Amount } from '@/components/amount'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { ChatTable } from '@/components/chat/chat-table'
import { rehypeAmount } from '@/lib/rehype-amount'
import { usePrivacy } from '@/lib/settings'

// While blurred, a gradient mask on the wrapper fades the blur halo out over a
// few px in every direction: unmasked it bleeds into neighboring prose and the
// line box crops it on top, while a rectangular clip cuts it off hard.
const BLUR_FADE_MASK: CSSProperties = {
  maskImage:
    'linear-gradient(to right, transparent, black 5px, black calc(100% - 5px), transparent), linear-gradient(to bottom, transparent, black 3px, black calc(100% - 3px), transparent)',
  maskComposite: 'intersect'
}

function AmountTag({ amount, currency }: { amount: string; currency: string }) {
  const { blurAmounts } = usePrivacy()
  return (
    <span className="inline-block" style={blurAmounts ? BLUR_FADE_MASK : undefined}>
      <Amount
        value={Math.round(Number(amount) * 1000)}
        currency={currency}
        colored={false}
        className="inline-block"
      />
    </span>
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
  td: ({ node: _node, children, ...props }) => <td {...props}>{children}</td>,
  span: ({ node: _node, children, ...props }) => {
    const { 'data-amount': amount, 'data-currency': currency } = props as typeof props & {
      'data-amount'?: string
      'data-currency'?: string
    }
    if (amount === undefined) return <span {...props}>{children}</span>
    return <AmountTag amount={amount} currency={String(currency)} />
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
