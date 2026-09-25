import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { SparklesIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

/**
 * The turn's heartbeat: a breathing sparkle at the foot of a reply for as long
 * as it generates, answer text included. Fades out when the turn settles; a
 * row that mounts already settled never shows it.
 */
export function GeneratingMark({ active }: { active: boolean }) {
  const [present, setPresent] = useState(active)
  if (active && !present) setPresent(true)
  if (!present) return null
  return (
    <div
      role="status"
      aria-label={active ? 'Generating' : undefined}
      className={cn(
        'flex h-5 items-center text-muted-foreground',
        !active && 'animate-out duration-300 fade-out-0 fill-mode-forwards'
      )}
      onAnimationEnd={(e) => {
        if (!active && e.target === e.currentTarget) setPresent(false)
      }}
    >
      <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-4 animate-sparkle" />
    </div>
  )
}
