import { HugeiconsIcon } from '@hugeicons/react'
import { TestTube01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/**
 * Small pill marking a feature as experimental. Amber-tinted so it reads as a
 * caution label rather than a neutral tag. Drop it in anywhere the chat
 * experience surfaces; pass `icon={false}` where the flask would crowd the row.
 */
export function ExperimentalBadge({
  className,
  icon = true
}: {
  className?: string
  icon?: boolean
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
        className
      )}
    >
      {icon && <HugeiconsIcon icon={TestTube01Icon} data-icon="inline-start" />}
      Experimental
    </Badge>
  )
}
