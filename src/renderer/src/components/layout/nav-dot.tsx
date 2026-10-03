import type { DotTone } from '@/lib/nav-status'
import { cn } from '@/lib/utils'

const TONES: Record<DotTone, string> = {
  attention: 'bg-warning-fill',
  info: 'bg-info',
  busy: 'animate-pulse-busy bg-sidebar-foreground'
}

/** A null tone draws a hollow placeholder of the same size. */
export function StatusDot({ tone, className }: { tone: DotTone | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block size-2 shrink-0 rounded-full',
        tone ? TONES[tone] : 'border border-sidebar-foreground/40',
        className
      )}
    />
  )
}

/** Status dot pinned to a sidebar icon's corner, so it shows with the sidebar collapsed. */
export function NavDot({ tone }: { tone: DotTone }) {
  // the cut-out ring tracks the row's own fill so it never shows as a halo
  return (
    <StatusDot
      tone={tone}
      className="absolute -top-0.5 -right-0.5 ring-2 ring-sidebar group-hover/menu-button:ring-sidebar-accent group-data-active/menu-button:ring-sidebar-accent"
    />
  )
}
