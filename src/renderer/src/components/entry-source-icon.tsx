import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDataTransferHorizontalIcon,
  Clock01Icon,
  Download01Icon
} from '@hugeicons/core-free-icons'
import type { ActionSource } from '@shared/ipc'

const SOURCE_ICONS: Partial<Record<ActionSource, typeof Clock01Icon>> = {
  detector: ArrowDataTransferHorizontalIcon,
  import: Download01Icon
}

export function EntrySourceIcon({
  source,
  size,
  className
}: {
  source: ActionSource
  size?: number
  className?: string
}) {
  return (
    <HugeiconsIcon icon={SOURCE_ICONS[source] ?? Clock01Icon} size={size} className={className} />
  )
}
