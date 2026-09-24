import { pickFile } from './files'

// Just enough of Electron for the real main-process modules and preload to run
// in one browser page. The preload's ipcRenderer calls land on the handlers the
// main modules registered with ipcMain, and pushes from main (webContents.send)
// come back out through ipcRenderer.on, all in-process.

type Handler = (event: unknown, ...args: unknown[]) => unknown
type Listener = (event: unknown, ...args: unknown[]) => void

const handlers = new Map<string, Handler>()
const mainListeners = new Map<string, Handler[]>()
const rendererListeners = new Map<string, Set<Listener>>()

// IPC structured-clones every payload; copying here too keeps the renderer
// from ever sharing an object with the main-side code
const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

const event = { sender: null }

function push(channel: string, payload: unknown): void {
  for (const listener of rendererListeners.get(channel) ?? []) listener(event, copy(payload))
}

export const ipcMain = {
  // a later registration replaces an earlier one, which is how the demo's
  // overrides take over a channel the real module registered
  handle(channel: string, handler: Handler): void {
    handlers.set(channel, handler)
  },
  on(channel: string, listener: Handler): void {
    mainListeners.set(channel, [...(mainListeners.get(channel) ?? []), listener])
  }
}

export const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for '${channel}'`)
    // let the caller's render commit before a synchronous handler blocks the page
    await Promise.resolve()
    return copy(await handler(event, ...args.map(copy)))
  },
  send(channel: string, ...args: unknown[]): void {
    for (const listener of mainListeners.get(channel) ?? []) listener(event, ...args.map(copy))
  },
  on(channel: string, listener: Listener): void {
    if (!rendererListeners.has(channel)) rendererListeners.set(channel, new Set())
    rendererListeners.get(channel)!.add(listener)
  },
  removeListener(channel: string, listener: Listener): void {
    rendererListeners.get(channel)?.delete(listener)
  }
}

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown): void {
    ;(window as unknown as Record<string, unknown>)[key] = api
  }
}

const webContents = { send: push }
const theWindow = {
  webContents,
  isFocused: (): boolean => document.hasFocus(),
  setProgressBar: (): void => {},
  setTitleBarOverlay: (): void => {},
  setBackgroundColor: (): void => {}
}

export const BrowserWindow = {
  getAllWindows: () => [theWindow],
  getFocusedWindow: () => theWindow
}

export const app = {
  getPath: (): string => '/demo',
  getVersion: (): string => __APP_VERSION__,
  isPackaged: true
}

export const nativeTheme = { themeSource: 'system', shouldUseDarkColors: false }

// the access URL helpers are swapped out in the demo; this only needs to exist
export const safeStorage = {
  isEncryptionAvailable: (): boolean => true
}

export const dialog = {
  // a real file picker; the chosen file's bytes wait in files.ts for the
  // import handler's readFileSync
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    const token = await pickFile()
    return token ? { canceled: false, filePaths: [token] } : { canceled: true, filePaths: [] }
  }
}

export const shell = {
  openExternal: async (url: string): Promise<void> => {
    window.open(url, '_blank', 'noopener')
  }
}

export const clipboard = {
  writeText: (text: string): void => {
    void navigator.clipboard?.writeText(text)
  }
}

// never constructed: notifyOs checks isSupported first
export const Notification = { isSupported: (): boolean => false }
