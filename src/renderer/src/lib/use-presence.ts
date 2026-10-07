import { useEffect, useState } from 'react'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * Whether something that is `shown` should still be mounted: true while shown
 * and for `exitMs` after, so it can fade out before it goes. Fade in with
 * `starting:opacity-0` and out on `shown` turning false.
 */
export function usePresence(shown: boolean, exitMs: number): boolean {
  const [present, setPresent] = useState(shown)
  if (shown && !present) setPresent(true)
  useEffect(() => {
    if (shown || !present) return
    const timer = setTimeout(() => setPresent(false), reducedMotion.matches ? 0 : exitMs)
    return () => clearTimeout(timer)
  }, [shown, present, exitMs])
  return shown || present
}
