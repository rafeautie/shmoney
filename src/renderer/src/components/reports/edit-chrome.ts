/** how edit-mode chrome fades, on widget cards and the report page header */
export const CHROME_FADE_MS = 200
export const CHROME_FADE = 'transition-opacity duration-200 motion-reduce:transition-none'
/** for chrome that mounts on entering edit mode (see usePresence) */
export const CHROME_ENTER = `${CHROME_FADE} starting:opacity-0`
