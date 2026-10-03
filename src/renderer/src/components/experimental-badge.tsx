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
      className={cn('border-warning-fill/30 bg-warning-fill/10 text-warning', className)}
    >
      {icon && <HugeiconsIcon icon={TestTube01Icon} data-icon="inline-start" />}
      Experimental
    </Badge>
  )
}
