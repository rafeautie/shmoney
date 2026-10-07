import { flushSync } from 'react-dom'
import type { ParsedLocation } from '@tanstack/react-router'
import { queryClient } from './query-client'

/** Matched by `:active-view-transition-type()` in main.css. */
export type ViewTransitionType = 'page' | 'panel' | 'month-prev' | 'month-next'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function canTransition(): boolean {
  return typeof document.startViewTransition === 'function' && !reducedMotion.matches
}

// A view still waiting on its first data would fade in a skeleton (or slide the
// previous month's placeholder) and then pop, so it switches at once instead.
// Only queries the new view observes count, not prefetches it started.
function skipIfAwaitingData(transition: ViewTransition): void {
  transition.ready.catch(() => {})
  transition.updateCallbackDone.then(
    () => {
      const awaiting = queryClient
        .getQueryCache()
        .getAll()
        .some((q) => q.state.status === 'pending' && q.isActive())
      if (awaiting) transition.skipTransition()
    },
    () => {}
  )
}

/** Runs a state update inside a view transition of the given type. */
export function transitionView(type: ViewTransitionType, update: () => void): void {
  if (!canTransition()) return update()
  const transition = document.startViewTransition({
    update: () => flushSync(update),
    types: [type]
  })
  skipIfAwaitingData(transition)
}

/** The router's `defaultViewTransition.types`: which transition a navigation gets, if any. */
export function routeTransitionTypes({
  fromLocation,
  toLocation,
  pathChanged
}: {
  fromLocation?: ParsedLocation
  toLocation: ParsedLocation
  pathChanged: boolean
}): ViewTransitionType[] | false {
  if (!fromLocation || !canTransition()) return false
  // pages keep their tab in a `tab` search param; any other search change
  // (filters, the settings dialog) is not a new view
  const tabChanged =
    (fromLocation.search as { tab?: string }).tab !== (toLocation.search as { tab?: string }).tab
  if (!pathChanged && !tabChanged) return false
  // the router starts the transition right after asking for its types
  queueMicrotask(() => {
    if (document.activeViewTransition) skipIfAwaitingData(document.activeViewTransition)
  })
  return [pathChanged ? 'page' : 'panel']
}
