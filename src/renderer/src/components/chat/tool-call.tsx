import { memo, useState } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { cn } from '@/lib/utils'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle
} from '@/components/ui/code-block'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace'

// The one shape every tool call takes in the transcript: a one-line trace row
// (icon, status label, chevron) that expands to the call's input and output.
// Tools differ only in label wording and the values they pass — the chrome,
// the states (shimmer while active, destructive when failed) and the IO layout
// live here so no tool can drift into custom transcript UI again.

/** a value as display text: strings verbatim (SQL stays SQL), everything else pretty JSON */
function ioText(value: unknown): string {
  if (typeof value === 'string') return value
  return (
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) ??
    String(value)
  )
}

/**
 * One side of the call as a small code block: a titled header with a copy
 * button over the capped-height, wrapping text. Memoized on the value: a big
 * query result is costly to pretty-print, and the chain re-renders its open
 * rows with every streamed patch.
 */
const IOSection = memo(function IOSection({
  label,
  value,
  failed = false
}: {
  label: string
  value: unknown
  failed?: boolean
}) {
  const text = ioText(value)
  return (
    // the muted colour sits on the block, not the content: cn reads text-footnote
    // as a colour, so the two on one element would drop the size
    <CodeBlock
      size="sm"
      variant={failed ? 'destructive' : 'default'}
      className={cn(!failed && 'text-muted-foreground')}
    >
      <CodeBlockHeader>
        <CodeBlockTitle>{label}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-56 text-footnote leading-4 select-text">
        {text}
      </CodeBlockContent>
    </CodeBlock>
  )
})

/**
 * One tool call in the transcript, any tool, any state. Always expandable,
 * live and settled alike — the shimmering line carries the activity; the
 * user's own toggle always wins. input/output are the values that crossed the
 * model boundary (or their in-flight preview) and render generically; pass
 * undefined while a side doesn't exist yet and its section is omitted.
 */
export function ToolCallCard({
  icon,
  label,
  active = false,
  failed = false,
  input,
  output
}: {
  icon: IconSvgElement
  label: string
  /** the call is still writing or executing; the line shimmers */
  active?: boolean
  failed?: boolean
  input?: unknown
  output?: unknown
}) {
  const [open, setOpen] = useState(false)
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? 'error' : active ? 'running' : undefined}>
          <TraceIcon>
            <HugeiconsIcon icon={icon} strokeWidth={2} />
          </TraceIcon>
          <TraceTitle>{label}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {input !== undefined && <IOSection label="Input" value={input} />}
        {output !== undefined && <IOSection label="Output" value={output} failed={failed} />}
        {input === undefined && output === undefined && (
          <p className="text-xs text-muted-foreground italic">Waiting for the call…</p>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
