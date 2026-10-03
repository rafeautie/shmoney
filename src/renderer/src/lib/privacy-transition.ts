import { useSyncExternalStore } from 'react'

/** Longest single digit transition plus the per-digit stagger, see .private-* in main.css. */
const SETTLE_MS = 950
/** ms of delay per px of distance from the toggle: the ripple's speed. */
const RIPPLE_MS_PER_PX = 0.35
const MAX_DELAY_MS = 600

let settling = false
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function setSettling(next: boolean): void {
  if (settling === next) return
  settling = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True while a blur-amounts toggle is animating; private figures keep their
 * per-digit markup until then, and render as plain text otherwise. */
export function usePrivacySettling(): boolean {
  return useSyncExternalStore(subscribe, () => settling)
}

/**
 * Call just before flipping the blur setting. Gives every on-screen private
 * figure a delay by its distance from the sidebar toggle so the change ripples
 * out from it, and pins off-screen ones still. All rects are read before any
 * write, so this costs one layout however many figures there are.
 */
export function startPrivacyTransition(): void {
  clearTimeout(timer)
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setSettling(false)
    return
  }
  const figures = Array.from(document.querySelectorAll<HTMLElement>('[data-private]'))
  const toggle = document.querySelector('[data-privacy-toggle]')?.getBoundingClientRect()
  const ox = toggle ? toggle.left + toggle.width / 2 : 0
  const oy = toggle ? toggle.top + toggle.height / 2 : 0
  const rects = figures.map((el) => el.getBoundingClientRect())
  let longest = 0
  figures.forEach((el, i) => {
    const r = rects[i]
    const onScreen =
      r.width > 0 &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      r.right > 0 &&
      r.left < window.innerWidth
    const delay = onScreen
      ? Math.min(
          MAX_DELAY_MS,
          Math.hypot(r.left - ox, r.top + r.height / 2 - oy) * RIPPLE_MS_PER_PX
        )
      : 0
    el.style.setProperty('--private-delay', `${Math.round(delay)}ms`)
    el.toggleAttribute('data-private-still', !onScreen)
    longest = Math.max(longest, delay)
  })
  setSettling(true)
  timer = setTimeout(() => setSettling(false), longest + SETTLE_MS)
}
