/**
 * The two colors Electron paints outside the renderer: the BrowserWindow
 * background (on screen before the renderer's first frame, so it is what
 * decides whether launch flashes white) and, on Windows/Linux, the glyphs of
 * the native caption buttons drawn over the title bar.
 *
 * Electron takes plain hex only, so these are hand-mirrored from --background
 * and --muted-foreground in renderer/src/assets/main.css. Change them together.
 */
export const THEME_CHROME = {
  light: { background: '#ffffff', symbol: '#696969' },
  dark: { background: '#0a0a0a', symbol: '#a1a1a1' }
} as const

/** Height of the app header (h-10), border included: the box is border-box. */
export const TITLE_BAR_HEIGHT = 40
