import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

// shadcn's Trace (base-mira), with two local changes: a running line uses the
// app's mask shimmer on the whole line (icon included) rather than upstream's
// text-clip shimmer on the title, so it matches every other status label; and
// the content panel takes its height animation from CollapsibleContent, which
// every disclosure shares, instead of bringing its own.

function Trace({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="trace"
      className={cn(
        'flex w-full min-w-0 flex-col gap-1.5 *:has-[>[data-slot=trace-line]]:flex *:has-[>[data-slot=trace-line]]:w-fit *:has-[>[data-slot=trace-line]]:max-w-full *:has-[>[data-slot=trace-line]]:min-w-0 *:has-[>[data-slot=trace-line]]:rounded-sm *:has-[>[data-slot=trace-line]]:text-left *:has-[>[data-slot=trace-line]]:outline-none *:has-[>[data-slot=trace-line]]:focus-visible:ring-2 *:has-[>[data-slot=trace-line]]:focus-visible:ring-ring/30',
        className
      )}
      {...props}
    />
  )
}

function TraceLine({
  className,
  status,
  ...props
}: React.ComponentProps<'span'> & {
  status?: 'running' | 'error' | 'pending'
}) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        'flex w-fit max-w-full min-w-0 items-center gap-2 text-xs/relaxed text-muted-foreground transition-colors in-[a,button]:cursor-pointer in-[a:hover,button:hover]:text-foreground data-[status=error]:text-destructive data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=pending]:opacity-60 data-[status=running]:animate-shimmer',
        className
      )}
      {...props}
    />
  )
}

function TraceIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [[data-slot=trace-title]~&]:-ml-1",
        className
      )}
      {...props}
    />
  )
}

function TraceTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="trace-title" className={cn('min-w-0 truncate', className)} {...props} />
}

function TraceDescription({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="trace-description"
      className={cn('shrink-0 text-muted-foreground/70 tabular-nums', className)}
      {...props}
    />
  )
}

function TraceCollapsible({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Collapsible>, 'open'> &
  (
    | { open?: undefined }
    | {
        open: boolean
        onOpenChange: NonNullable<React.ComponentProps<typeof Collapsible>['onOpenChange']>
      }
  )) {
  return (
    <Collapsible
      data-slot="trace-collapsible"
      className={cn('flex w-full min-w-0 flex-col', className)}
      {...props}
    />
  )
}

function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      data-slot="trace-collapsible-trigger"
      className={cn(
        'group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm text-left text-muted-foreground transition-colors outline-none not-disabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-default has-[[data-status=error]]:text-destructive',
        className
      )}
      {...props}
    >
      {children}
      <TraceIcon className="transition-[rotate,opacity] duration-200 ease-out group-aria-expanded/trace-collapsible-trigger:rotate-90 motion-reduce:transition-none">
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
      </TraceIcon>
    </CollapsibleTrigger>
  )
}

function TraceCollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  // the gap above the content is margin inside the animated panel, so it
  // collapses with the panel rather than hanging below a closed row
  return (
    <CollapsibleContent data-slot="trace-collapsible-content" className="min-w-0" {...props}>
      <div
        data-slot="trace-collapsible-content-inner"
        className={cn(
          'mt-1.5 mb-1 ml-[calc(--spacing(1.75)-1px)] min-w-0 border-l pr-1 pl-3.75 wrap-break-word text-muted-foreground',
          className
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  )
}

export {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent
}
