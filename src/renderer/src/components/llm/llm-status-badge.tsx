import { useLlmStatus } from '@/lib/llm'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Dot + label for whether the model is currently in memory, with a tooltip
 * explaining the state on hover. Reads live status itself, so any surface
 * (settings card, chat composer) can drop it in.
 */
export function LlmStatusBadge({ className }: { className?: string }) {
  const runtime = useLlmStatus().data?.runtime

  const { dot, label, explanation } =
    runtime === 'ready'
      ? {
          dot: 'bg-emerald-500',
          label: 'Loaded',
          explanation: 'The model is in memory and responds right away.'
        }
      : runtime === 'loading'
        ? {
            dot: 'bg-amber-500 animate-pulse',
            label: 'Loading',
            explanation: 'The model is loading into memory.'
          }
        : {
            dot: 'bg-muted-foreground/40',
            label: 'Not loaded',
            explanation: 'The model loads into memory when it is first needed.'
          }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn('cursor-default text-muted-foreground', className)}
          />
        }
      >
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dot)} />
        {label}
      </TooltipTrigger>
      <TooltipContent sideOffset={8} className="max-w-56">
        {explanation}
      </TooltipContent>
    </Tooltip>
  )
}
