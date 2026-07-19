import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Download01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

// Shared shell for tabular content in the chat transcript: markdown tables in
// answers (ChatTable) and the chart card's Data toggle (ChatTableViewport).

/** Copy (tab-separated, pastes into spreadsheets) and CSV download, built from the rendered rows. */
function ChatTableActions({
  containerRef,
  className
}: {
  /** actions copy/download whatever <table> renders inside this element */
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const serialize = (delimiter: '\t' | ','): string => {
    const field = (value: string): string =>
      delimiter === ',' && /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    return [...(containerRef.current?.querySelectorAll('tr') ?? [])]
      .map((row) =>
        [...row.querySelectorAll('th, td')]
          .map((cell) => field(cell.textContent ?? ''))
          .join(delimiter)
      )
      .join('\n')
  }

  const copy = () => {
    void navigator.clipboard.writeText(serialize('\t'))
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([serialize(',')], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'table.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button variant="ghost" size="icon-sm" type="button" onClick={copy}>
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
        <span className="sr-only">Copy table</span>
      </Button>
      <Button variant="ghost" size="icon-sm" type="button" onClick={download}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
        <span className="sr-only">Download table as CSV</span>
      </Button>
    </div>
  )
}

/**
 * Height-capped scroll area owning the one canonical chat-table look (sticky
 * header, row rules). Styling rides descendant selectors so any
 * plain <table> child renders identically, whether hand-built from query
 * results or produced by markdown. Full-bleed by design: no side/bottom
 * border and no rounding of its own — it sits flush against its card's
 * edges, square on top, and the card's overflow-hidden rounds the bottom.
 */
export function ChatTableViewport({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea
      horizontal
      className="bg-background"
      // scrollbars stay hidden until the pointer is over the table (or it scrolls)
      scrollbarClassName="opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100"
      // border-separate because sticky headers and collapsed borders don't mix.
      // The top border lives on the th cells (not the container) so the line
      // rides with the sticky header.
      viewPortClassName={cn(
        'max-h-56',
        '[&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:text-xs',
        '[&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:border-y [&_th]:bg-muted [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap',
        '[&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_td]:whitespace-nowrap [&_td]:text-muted-foreground',
        '[&_tbody>tr:last-child>td]:border-b-0'
      )}
    >
      {children}
    </ScrollArea>
  )
}

/** Card for markdown tables in answers: copy/download header above the table. */
export function ChatTable({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    // padding lives on the header, not the card, so the table below runs
    // flush to the card's left/right/bottom edges; overflow-hidden lets the
    // card's rounding clip the table's bottom corners
    <div
      ref={containerRef}
      className={cn('overflow-hidden rounded-lg border bg-muted/30 text-xs', className)}
    >
      <div className="flex items-start justify-between gap-2 p-2">
        <div className="min-w-0 flex-1" />
        <ChatTableActions containerRef={containerRef} className="shrink-0" />
      </div>
      <ChatTableViewport>{children}</ChatTableViewport>
    </div>
  )
}
