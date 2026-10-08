import { BrowserWindow } from 'electron'
import { USES_TITLE_BAR_OVERLAY } from './chrome-theme'
import { readSettings, writeSetting } from './settings-store'
import { nextUiScale, SETTINGS_IPC, type UiScale } from '@shared/settings'
import { TITLE_BAR_HEIGHT } from '@shared/theme'

/**
 * The header is sized in CSS px, which page zoom scales, but the native caption
 * buttons and traffic lights are placed in window units, so they follow by hand.
 *
 * The caption buttons sit one unit short of the header so its bottom border runs
 * unbroken beneath them, the way a Windows 11 title bar separator does. At the
 * full height the OS paints the buttons' background over that row and the
 * border stops short of the window edge.
 */
export function titleBarOverlayHeight(scale: number): number {
  return Math.round(TITLE_BAR_HEIGHT * scale) - 1
}

export function trafficLightPosition(scale: number): { x: number; y: number } {
  // the lights are about 16 units tall; center them in the scaled header
  return { x: 16, y: Math.round((TITLE_BAR_HEIGHT * scale - 16) / 2) }
}

export function applyUiScale(scale: UiScale): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.setZoomFactor(scale)
    if (USES_TITLE_BAR_OVERLAY) {
      window.setTitleBarOverlay({ height: titleBarOverlayHeight(scale) })
    } else {
      window.setWindowButtonPosition(trafficLightPosition(scale))
    }
  }
}

/** Zoom shortcuts and Ctrl+wheel land here, so they step the saved setting. */
export function stepUiScale(direction: -1 | 0 | 1): void {
  const current = readSettings().uiScale
  const next = nextUiScale(current, direction)
  if (next === current) return
  writeSetting('uiScale', next)
  applyUiScale(next)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SETTINGS_IPC.changed, { key: 'uiScale', value: next })
  }
}

/**
 * Chromium's own zoom shortcuts come from menu roles, which Windows and Linux
 * don't have, and would bypass the setting anyway; handle them for every
 * platform here instead. Ctrl+wheel arrives as zoom-changed.
 */
export function routeZoomInput(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
    const direction =
      input.key === '=' || input.key === '+' || input.code === 'NumpadAdd'
        ? 1
        : input.key === '-' || input.code === 'NumpadSubtract'
          ? -1
          : input.key === '0' || input.code === 'Numpad0'
            ? 0
            : null
    if (direction === null) return
    event.preventDefault()
    stepUiScale(direction)
  })
  window.webContents.on('zoom-changed', (_event, zoomDirection) => {
    stepUiScale(zoomDirection === 'in' ? 1 : -1)
  })
}
