import { cn } from '@/lib/utils'

const TONES = {
  // the user needs to act
  attention: 'bg-amber-500',
  // something new, nothing wrong
  info: 'bg-blue-500'
} as const

export type NavDotTone = keyof typeof TONES

/** Status dot pinned to a sidebar icon's corner, so it shows with the sidebar collapsed. */
export function NavDot({ tone }: { tone: NavDotTone }) {
  return (
    <span
      className={cn(
        'absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-sidebar',
        TONES[tone]
      )}
    />
  )
}
