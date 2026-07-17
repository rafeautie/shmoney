import { createContext, useContext, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Download01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

// Shared shell for tabular content in the chat transcript: query-tool results
// and markdown tables in answers. Composable so consumers can place the
// actions anywhere inside the root (the query card puts them on its title
// line); ChatTable below is the packaged form for places without one.

const ChatTableContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null)

/** Serialization scope: actions copy/download whatever <table> renders inside. */
export function ChatTableRoot({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <ChatTableContext.Provider value={containerRef}>
      <div ref={containerRef} className={className}>
        {children}
      </div>
    </ChatTableContext.Provider>
  )
}

/** Copy (tab-separated, pastes into spreadsheets) and CSV download, built from the rendered rows. */
export function ChatTableActions({ className }: { className?: string }) {
  const containerRef = useContext(ChatTableContext)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const serialize = (delimiter: '\t' | ','): string => {
    const field = (value: string): string =>
      delimiter === ',' && /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    return [...(containerRef?.current?.querySelectorAll('tr') ?? [])]
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
 * results or produced by markdown.
 */
export function ChatTableViewport({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea
      horizontal
      className="rounded-md border bg-background"
      // scrollbars stay hidden until the pointer is over the table (or it scrolls)
      scrollbarClassName="opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100"
      // border-separate because sticky headers and collapsed borders don't mix
      viewPortClassName={cn(
        'max-h-56',
        '[&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:text-xs',
        '[&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:border-b [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap',
        '[&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_td]:whitespace-nowrap [&_td]:text-muted-foreground',
        '[&_tbody>tr:last-child>td]:border-b-0'
      )}
    >
      {children}
    </ScrollArea>
  )
}

/**
 * The generalized query-card body: a padded muted card with a header row
 * (title on the left, copy/download aligned right) above arbitrary content.
 * The query card titles it with the SQL; markdown tables use it untitled.
 */
export function ChatTableCard({
  title,
  actions = true,
  children,
  className
}: {
  /** left side of the header row; omit for plain tables */
  title?: React.ReactNode
  /** hide while there are no rendered rows to serialize */
  actions?: boolean
  children?: React.ReactNode
  className?: string
}) {
  return (
    <ChatTableRoot className={cn('rounded-lg border bg-muted/30 p-2 text-xs', className)}>
      {(title != null || actions) && (
        <div className="flex items-start justify-between gap-2 pb-2">
          <div className="min-w-0 flex-1 py-1">{title}</div>
          {actions && <ChatTableActions className="shrink-0 py-1" />}
        </div>
      )}
      {/* a titled header (the SQL) reads as its own block, so give it more room */}
      {children ? <div>{children}</div> : null}
    </ChatTableRoot>
  )
}

/** Packaged form for markdown tables in answers: the same card, untitled. */
export function ChatTable({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <ChatTableCard className={className}>
      <ChatTableViewport>{children}</ChatTableViewport>
    </ChatTableCard>
  )
}
