import { BrowserWindow, nativeTheme } from 'electron'
import { MODAL_BACKDROP_OPACITY, THEME_CHROME } from '@shared/theme'
import type { Settings } from '@shared/settings'

/** Windows and Linux draw the caption buttons; macOS draws traffic lights. */
export const USES_TITLE_BAR_OVERLAY = process.platform !== 'darwin'

/**
 * Colors for the parts of the frame Electron paints. Resolved through
 * nativeTheme so 'system' follows the OS, and so the renderer's
 * prefers-color-scheme agrees with what main just painted.
 */
export function resolvedChrome(): (typeof THEME_CHROME)[keyof typeof THEME_CHROME] {
  return nativeTheme.shouldUseDarkColors ? THEME_CHROME.dark : THEME_CHROME.light
}

// how far the caption buttons have faded toward the modal backdrop's black,
// 0 to 1; they sit above the page, so the backdrop itself cannot cover them
let dim = 0
let fade: ReturnType<typeof setInterval> | undefined

function darken(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((i) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
  )
  return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('')
}

function paintOverlay(): void {
  if (!USES_TITLE_BAR_OVERLAY) return
  const chrome = resolvedChrome()
  const amount = dim * MODAL_BACKDROP_OPACITY
  for (const window of BrowserWindow.getAllWindows()) {
    window.setTitleBarOverlay({
      color: darken(chrome.background, amount),
      symbolColor: darken(chrome.symbol, amount)
    })
  }
}

function paintChrome(): void {
  const chrome = resolvedChrome()
  for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(chrome.background)
  paintOverlay()
}

/** Tweens the caption buttons alongside the backdrop's CSS fade (ease-out). */
export function setChromeDimmed(value: boolean, fadeMs: number): void {
  clearInterval(fade)
  const from = dim
  const to = value ? 1 : 0
  const start = Date.now()
  fade = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / fadeMs)
    dim = from + (to - from) * (1 - (1 - t) ** 2)
    paintOverlay()
    if (t === 1) clearInterval(fade)
  }, 16)
}

export function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
  paintChrome()
}

/** Called once at startup, before the window exists. */
export function initChromeTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
  // the OS can flip while the app runs; only reaches here when theme is 'system'
  nativeTheme.on('updated', paintChrome)
}
