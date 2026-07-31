/**
 * The two colors Electron paints outside the renderer: the BrowserWindow
 * background (on screen before the renderer's first frame, so it is what
 * decides whether launch flashes white) and, on Windows/Linux, the native
 * caption buttons drawn over the title bar.
 *
 * Electron takes plain hex only, so these are hand-mirrored from --background
 * and --muted-foreground in renderer/src/assets/main.css. Change them together.
 */
export const THEME_CHROME = {
  light: { background: '#ffffff', symbol: '#737373' },
  dark: { background: '#0a0a0a', symbol: '#a1a1a1' }
} as const

/** Height of the app header (h-12), border included: the box is border-box. */
export const TITLE_BAR_HEIGHT = 48

/**
 * Height the native caption buttons are drawn at. One pixel short of the header
 * so its bottom border runs unbroken beneath them, the way a Windows 11 title
 * bar separator does. At the full header height the OS paints the buttons'
 * background over that row and the border stops short of the window edge.
 */
export const TITLE_BAR_OVERLAY_HEIGHT = TITLE_BAR_HEIGHT - 1
