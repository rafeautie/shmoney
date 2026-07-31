import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { readSettings, writeSetting } from './settings-store'
import type { Settings } from '@shared/settings'

type WindowState = NonNullable<Settings['windowState']>

const FIRST_RUN: WindowState = { width: 1200, height: 800, maximized: false }

// resize/move fire continuously while dragging; one write per gesture is plenty
const SAVE_DEBOUNCE_MS = 400

/**
 * How much of the saved rect has to land on a connected display for it to be
 * worth restoring. Enough of the title bar has to be reachable that the window
 * can still be dragged back, which a pure intersection test doesn't guarantee.
 */
const MIN_VISIBLE = { width: 200, height: 100 }

function isReachable(bounds: Rectangle): boolean {
  // getDisplayMatching returns the display overlapping the rect most, or the
  // nearest one when it overlaps nothing at all
  const area = screen.getDisplayMatching(bounds).workArea
  const overlapX =
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const overlapY =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  return overlapX >= MIN_VISIBLE.width && overlapY >= MIN_VISIBLE.height
}

/** Bounds to open with. Falls back to the first-run size and lets the OS place it. */
export function loadWindowState(): WindowState {
  const saved = readSettings().windowState
  if (!saved) return FIRST_RUN
  if (saved.x === undefined || saved.y === undefined) return saved
  // a monitor was unplugged or the resolution changed since the last run
  if (!isReachable({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })) {
    return { width: saved.width, height: saved.height, maximized: saved.maximized }
  }
  return saved
}

export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    // a minimized window reports neither a useful rect nor its real maximized
    // state, so saving here would clobber both
    if (window.isDestroyed() || window.isMinimized()) return
    // normal bounds are the pre-maximize rect, so unmaximizing after a restart
    // gives back the size the window actually had
    const { x, y, width, height } = window.getNormalBounds()
    writeSetting('windowState', { x, y, width, height, maximized: window.isMaximized() })
  }

  const scheduleSave = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
