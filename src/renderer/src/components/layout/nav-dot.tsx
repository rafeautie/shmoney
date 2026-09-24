import type { DotTone } from '@/lib/nav-status'
import { cn } from '@/lib/utils'

const TONES: Record<DotTone, string> = {
  attention: 'bg-amber-500',
  info: 'bg-blue-500',
  busy: 'animate-pulse-busy bg-sidebar-foreground'
}

export function StatusDot({ tone, className }: { tone: DotTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('block size-2 shrink-0 rounded-full', TONES[tone], className)}
    />
  )
}

/** Status dot pinned to a sidebar icon's corner, so it shows with the sidebar collapsed. */
export function NavDot({ tone }: { tone: DotTone }) {
  return <StatusDot tone={tone} className="absolute -top-0.5 -right-0.5 ring-2 ring-sidebar" />
}
