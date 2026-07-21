import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'

// The one shape every tool call takes in the transcript: a one-line indicator
// (status label, chevron) that expands to the call's input and output. The
// tool's icon lives on the chain's rail, not here (see ToolChain). Tools differ
// only in label wording and the values they pass — the chrome, the states
// (shimmer while active, destructive when failed) and the IO layout live here
// so no tool can drift into custom transcript UI again.

/** a value as display text: strings verbatim (SQL stays SQL), everything else pretty JSON */
function ioText(value: unknown): string {
  if (typeof value === 'string') return value
  return (
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) ??
    String(value)
  )
}

function IOSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium">{label}</div>
      {children}
    </div>
  )
}

/**
 * The output, encapsulated in its own viewport against the panel's muted
 * card: capped height, scrollbar hidden until the pointer is over it (or it
 * scrolls), matching ChatTableViewport's reveal.
 */
function OutputSection({ value }: { value: unknown }) {
  return (
    <IOSection label="Output">
      <ScrollArea
        className="rounded-md border bg-background"
        scrollbarClassName="opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100"
        viewPortClassName="max-h-56"
      >
        <pre className="p-2 font-mono whitespace-pre-wrap wrap-break-word text-muted-foreground">
          {ioText(value)}
        </pre>
      </ScrollArea>
    </IOSection>
  )
}

/**
 * One tool call in the transcript, any tool, any state. Always expandable,
 * live and settled alike — the shimmering label carries the activity; the
 * user's own toggle always wins. input/output are the values that crossed the
 * model boundary (or their in-flight preview) and render generically; pass
 * undefined while a side doesn't exist yet and its section is omitted.
 */
export function ToolCallCard({
  label,
  active = false,
  failed = false,
  input,
  output
}: {
  label: string
  /** the call is still writing or executing; the label shimmers */
  active?: boolean
  failed?: boolean
  input?: unknown
  output?: unknown
}) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'group/tool flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
          active && 'animate-shimmer',
          failed && 'text-destructive hover:text-destructive'
        )}
      >
        <span>{label}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="-ml-0.5 size-3.5 group-data-panel-open/tool:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 flex flex-col gap-2 rounded-lg border bg-muted/30 p-2 text-xs">
          {input !== undefined && (
            <IOSection label="Input">
              <pre className="max-h-56 overflow-y-auto font-mono whitespace-pre-wrap wrap-break-word text-muted-foreground">
                {ioText(input)}
              </pre>
            </IOSection>
          )}
          {output !== undefined && <OutputSection value={output} />}
          {input === undefined && output === undefined && (
            <p className="text-muted-foreground italic">Waiting for the call…</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
