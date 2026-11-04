import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'
import { isMac } from './platform'
import { isDialogOpen, isTypingTarget } from './utils'

// The history knows whether it can go back but not forward, so the furthest
// entry reached is tracked here: a push cuts the forward stack, back/forward
// only move within it.
let furthest = 0

const indexOf = (history: RouterHistory): number => history.location.state.__TSR_index ?? 0

/** Where the app stands in its history, for the title bar's back/forward buttons. */
export function useHistoryNav(): {
  canGoBack: boolean
  canGoForward: boolean
  back: () => void
  forward: () => void
} {
  const { history } = useRouter()
  const position = useSyncExternalStore(
    (notify) =>
      history.subscribe(({ action }) => {
        const index = indexOf(history)
        furthest = action.type === 'PUSH' ? index : Math.max(furthest, index)
        notify()
      }),
    () => `${indexOf(history)}:${Math.max(furthest, indexOf(history))}`
  )
  const [index, last] = position.split(':').map(Number)
  return {
    canGoBack: index > 0,
    canGoForward: index < last,
    back: () => history.back(),
    forward: () => history.forward()
  }
}

/** Alt+←/→ (Cmd+[ and ] on macOS) and the mouse's back/forward buttons, as in a browser. */
export function useHistoryShortcuts(): void {
  const { history } = useRouter()
  useEffect(() => {
    const back = (): void => history.back()
    const forward = (): void => history.forward()
    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target) || isDialogOpen()) return
      const backKey = isMac
        ? event.metaKey && event.key === '['
        : event.altKey && event.key === 'ArrowLeft'
      const forwardKey = isMac
        ? event.metaKey && event.key === ']'
        : event.altKey && event.key === 'ArrowRight'
      if (!backKey && !forwardKey) return
      event.preventDefault()
      if (backKey) back()
      else forward()
    }
    function onMouseUp(event: MouseEvent): void {
      if (event.button === 3) back()
      if (event.button === 4) forward()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [history])
}
