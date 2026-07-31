import { BrowserWindow, nativeTheme } from 'electron'
import { THEME_CHROME } from '@shared/theme'
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

function paintChrome(): void {
  const chrome = resolvedChrome()
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(chrome.background)
    if (USES_TITLE_BAR_OVERLAY) {
      window.setTitleBarOverlay({ color: chrome.background, symbolColor: chrome.symbol })
    }
  }
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
