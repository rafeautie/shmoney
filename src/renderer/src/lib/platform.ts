/**
 * macOS keeps its traffic lights at the window's top-left corner, which sits
 * over the sidebar rather than the app header, so the sidebar has to leave room.
 */
export const isMac = window.api.app.platform === 'darwin'
