/**
 * macOS keeps its traffic lights at the window's top-left corner, which sits
 * over the sidebar rather than the app header, so the sidebar has to leave room.
 */
export const isMac = window.api.app.platform === 'darwin'

/**
 * The interactive web demo (see src/demo): no on-device model, updater or OS
 * integration. False in its screenshot mode, which renders like the desktop app.
 */
export const isDemo =
  import.meta.env.VITE_SHMONEY_DEMO === '1' && !('shot' in document.documentElement.dataset)

export const DESKTOP_APP_URL = 'https://rafe.dev/shmoney'
