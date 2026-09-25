import { useLayoutEffect, useRef, type ComponentProps, type RefObject } from 'react'
import { Streamdown, defaultRehypePlugins } from 'streamdown'
import { Amount } from '@/components/amount'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { ChatTable } from '@/components/chat/chat-table'
import { rehypeAmount } from '@/lib/rehype-amount'
import { rehypeWords } from '@/lib/rehype-words'

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
        blurClassName="scale-85"
      />
    )
  }
}

// passing rehypePlugins REPLACES streamdown's defaults, so spread them back in
// (keeping sanitize/harden) and run the amount plugin last, post-sanitize.
// While streaming, words are also split out so each can fade in
const rehypePlugins = [...Object.values(defaultRehypePlugins), rehypeAmount]
const streamingRehypePlugins = [...rehypePlugins, rehypeWords]

const WORD_FADE_MS = 450

/**
 * Fades each streamed word in from the moment it first appeared. Arrival is
 * tracked per word position across the whole answer, not per markdown block,
 * and a word that re-renders mid-fade resumes where it was via a negative
 * delay, so earlier words always stay ahead of later ones however streamdown
 * re-renders. A MutationObserver (not an effect) catches new words, since its
 * callback runs before the browser paints them.
 */
function useWordFade(ref: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const arrivals: number[] = []
    const apply = () => {
      const now = performance.now()
      root.querySelectorAll<HTMLElement>('[data-word]').forEach((word, i) => {
        const age = now - (arrivals[i] ??= now)
        if (age >= WORD_FADE_MS || word.classList.contains('animate-word-in')) return
        word.style.animationDelay = `${-age}ms`
        word.classList.add('animate-word-in')
      })
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [ref, active])
}

/** An assistant answer as Markdown, streaming-aware via streamdown. */
export function AssistantBubble({
  text,
  isStreaming = false
}: {
  text: string
  isStreaming?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useWordFade(ref, isStreaming)
  return (
    // full width (not the default shrink-wrap) so markdown tables span the column
    <Bubble variant="ghost" className="w-full">
      <BubbleContent className="w-full">
        <div ref={ref} className="contents">
          <Streamdown
            mode={isStreaming ? 'streaming' : 'static'}
            isAnimating={isStreaming}
            components={streamdownComponents}
            rehypePlugins={isStreaming ? streamingRehypePlugins : rehypePlugins}
          >
            {text}
          </Streamdown>
        </div>
      </BubbleContent>
    </Bubble>
  )
}
