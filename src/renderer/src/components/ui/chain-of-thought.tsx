import type { ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, BrainIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/**
 * A chain of thought: the model's reasoning and tool calls as one collapsible
 * timeline of steps. Ported from ai-elements' chain-of-thought onto Base UI +
 * hugeicons, and reduced to the steps this app renders (the upstream search
 * result and image steps have no counterpart here).
 *
 * Unlike upstream, the header and content share one Collapsible root rather
 * than syncing two through context, so open state needs no provider.
 */
export function ChainOfThought(props: ComponentProps<typeof Collapsible>) {
  return <Collapsible data-slot="chain-of-thought" {...props} />
}

export function ChainOfThoughtHeader({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group/cot flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={BrainIcon} strokeWidth={2} className="size-3.5" />
      <span className="text-left">{children ?? 'Chain of thought'}</span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        strokeWidth={2}
        className="size-3.5 transition-transform group-data-panel-open/cot:rotate-180"
      />
    </CollapsibleTrigger>
  )
}

export function ChainOfThoughtContent({
  className,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn('mt-1.5 space-y-3', className)} {...props} />
}

const stepStatusStyles = {
  complete: 'text-muted-foreground',
  active: 'text-foreground',
  pending: 'text-muted-foreground/50'
}

/**
 * One step on the timeline: an icon on the rail, with the step's own content
 * (usually its own collapsible summary) beside it. The rail runs down through
 * the gap to the next step. Omit the icon for a step the header already speaks
 * for — the rail then runs the step's full height as a quote bar, and the
 * gutter keeps the content aligned with the steps that do have one.
 */
export function ChainOfThoughtStep({
  icon,
  status = 'complete',
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  icon?: IconSvgElement
  status?: keyof typeof stepStatusStyles
}) {
  return (
    <div
      className={cn(
        'group/step flex gap-2 animate-in fade-in-0 slide-in-from-top-2',
        stepStatusStyles[status],
        className
      )}
      {...props}
    >
      {/* w-3.5 fixes the gutter, so an icon-less step still lines up */}
      <div className="flex w-3.5 shrink-0 flex-col items-center">
        {/* h-4 matches the text-xs line box, so the icon centres on the label */}
        {icon && (
          <div className="flex h-4 items-center">
            <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
          </div>
        )}
        {/* -mb-3 reaches into the parent's space-y-3 gap so the rail is unbroken.
            Under an icon the rail is a connector, so the last step drops it
            rather than dangle one into nothing; without an icon it's a quote bar
            down the step's own text, which stands on its own — it just stops at
            the text instead of overhanging. */}
        <div
          className={cn(
            '-mb-3 w-px flex-1 bg-border group-last/step:mb-0',
            icon && 'mt-1 group-last/step:hidden'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
