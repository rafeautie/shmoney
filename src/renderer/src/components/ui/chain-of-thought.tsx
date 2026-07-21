import type { ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, BrainIcon } from '@hugeicons/core-free-icons'
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
        'group/cot flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={BrainIcon} strokeWidth={2} className="size-3.5" />
      <span className="text-left">{children ?? 'Chain of thought'}</span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        className="-ml-0.5 size-3.5 group-data-panel-open/cot:rotate-90"
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
  active: 'text-foreground'
}

/**
 * One step on the timeline: an icon on the rail, with the step's own content
 * (usually its own collapsible summary) beside it. Every step keeps a rail — so
 * an expandable tool card always has the spine beside it, the last step
 * included — and a connector reaches up out of the first step to the header, so
 * the summary and the steps read as one unbroken chain. An icon marks where the
 * step begins; omit it for a step the header already speaks for (the rail is
 * then a plain quote bar), and the gutter keeps the content aligned either way.
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
    <div className={cn('group/step flex gap-2', stepStatusStyles[status], className)} {...props}>
      {/* w-3.5 fixes the gutter, so an icon-less step still lines up */}
      <div className="relative flex w-3.5 shrink-0 flex-col items-center">
        {/* connector up into the gap above: on the first step it reaches the
            header, joining the summary to the rail; on later steps it overlaps
            the previous step's overhang, so the spine is one line throughout */}
        <div className="absolute -top-1.5 left-1/2 h-1.5 w-px -translate-x-1/2 bg-border" />
        {/* h-4 matches the text-xs line box, so the icon centres on the label */}
        {icon && (
          <div className="flex h-4 items-center">
            <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
          </div>
        )}
        {/* -mb-3 reaches into the parent's space-y-3 gap so the rail is unbroken;
            the last step stops at its own bottom instead of overhanging. An icon
            step's rail picks up below the icon; an icon-less step's runs its full
            height as a quote bar. */}
        <div className={cn('-mb-3 w-px flex-1 bg-border group-last/step:mb-0', icon && 'mt-1')} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
