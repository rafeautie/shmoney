import { app, BrowserWindow, ipcMain } from 'electron'
// electron-updater is CJS with getter-defined exports; a named import compiles
// but throws at runtime in the ESM main bundle, so destructure the default
import electronUpdater from 'electron-updater'
import { createLogger } from '../logging'
import { UPDATES_IPC, type UpdateState } from '@shared/updates'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// set SHMONEY_TEST_UPDATES to exercise the update flow in dev against a
// git-ignored dev-app-update.yml (see docs/RELEASING.md)
const testing = !!process.env.SHMONEY_TEST_UPDATES

// updates only work in packaged builds; on macOS electron-updater additionally
// requires a code-signed app, which this project doesn't have
const supported = testing || (app.isPackaged && process.platform !== 'darwin')

let state: UpdateState = {
  status: supported ? 'idle' : 'disabled',
  version: null,
  progress: null,
  error: null
}

function setState(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  BrowserWindow.getAllWindows()[0]?.webContents.send(UPDATES_IPC.stateChanged, state)
}

// re-checking mid-download restarts the download, and a downloaded update
// needs a restart rather than another check
function checkable(): boolean {
  return supported && state.status !== 'downloading' && state.status !== 'downloaded'
}

export function registerUpdatesIpc(): void {
  ipcMain.handle(UPDATES_IPC.getState, (): UpdateState => state)
  ipcMain.handle(UPDATES_IPC.check, async (): Promise<UpdateState> => {
    // failures surface through the 'error' event, so the invoke itself never rejects
    if (checkable()) await autoUpdater.checkForUpdates().catch(() => {})
    return state
  })
  ipcMain.handle(UPDATES_IPC.quitAndInstall, (): void => {
    if (state.status === 'downloaded') autoUpdater.quitAndInstall()
  })
}

export function startUpdateChecks(): void {
  if (!supported) return
  if (testing) autoUpdater.forceDevUpdateConfig = true

  // electron-updater's internals go to the same scrubbed local file; its
  // logger slot accepts our Logger since it only ever passes one argument
  autoUpdater.logger = createLogger('updater')

  autoUpdater.autoDownload = true
  // an ignored Restart prompt still applies the update on the next normal quit
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (info) =>
    setState({ status: 'downloading', version: info.version, progress: null })
  )
  autoUpdater.on('update-not-available', () => setState({ status: 'up-to-date' }))
  autoUpdater.on('download-progress', (p) =>
    setState({ progress: { percent: p.percent, transferred: p.transferred, total: p.total } })
  )
  autoUpdater.on('update-downloaded', (info) =>
    setState({ status: 'downloaded', version: info.version, progress: null })
  )
  // offline / GitHub hiccups are routine: recorded for the About card, never a notification
  autoUpdater.on('error', (err) => setState({ status: 'error', error: err.message }))

  // let startup (migrations, first window paint) win the first seconds
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 5_000)
  setInterval(() => {
    if (checkable()) void autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_INTERVAL_MS)
}
