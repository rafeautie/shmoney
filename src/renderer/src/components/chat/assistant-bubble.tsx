import { memo, useLayoutEffect, useRef, type ComponentProps, type RefObject } from 'react'
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
    return (
      <Amount
        value={Math.round(Number(amount) * 1000)}
        currency={String(currency)}
        colored={false}
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
    // words before this index have finished fading, so a re-render of one
    // needs nothing; each pass walks only the still-fading tail
    let settled = 0
    const apply = () => {
      const now = performance.now()
      const words = root.querySelectorAll<HTMLElement>('[data-word]')
      while (settled < words.length && now - (arrivals[settled] ?? now) >= WORD_FADE_MS) settled++
      for (let i = settled; i < words.length; i++) {
        const word = words[i]
        const age = now - (arrivals[i] ??= now)
        if (age >= WORD_FADE_MS || word.classList.contains('animate-word-in')) continue
        word.style.animationDelay = `${-age}ms`
        word.classList.add('animate-word-in')
      }
    }
    const addsWord = (node: Node) =>
      node instanceof Element && (node.matches('[data-word]') || node.querySelector('[data-word]'))
    apply()
    // only a newly inserted word element can lack its fade class
    const observer = new MutationObserver((records) => {
      if (records.some((record) => Array.from(record.addedNodes).some(addsWord))) apply()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [ref, active])
}

/** An assistant answer as Markdown, streaming-aware via streamdown. */
export const AssistantBubble = memo(function AssistantBubble({
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
})
