import { app, BrowserWindow, ipcMain } from 'electron'
// electron-updater is CJS with getter-defined exports; a named import compiles
// but throws at runtime in the ESM main bundle, so destructure the default
import electronUpdater from 'electron-updater'
import { createLogger } from '../logging'
import { findNewerMacRelease } from '../release-check'
import { UPDATES_IPC, type UpdateState } from '@shared/updates'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// set SHMONEY_TEST_UPDATES to exercise the update flow in dev against a
// git-ignored dev-app-update.yml (see docs/RELEASING.md)
const testing = !!process.env.SHMONEY_TEST_UPDATES

// updates only work in packaged builds
const supported = testing || app.isPackaged
// on macOS electron-updater requires a code-signed app, which this project
// doesn't have, so there the app only finds a newer release and links to it
const manual = supported && !testing && process.platform === 'darwin'

const log = createLogger('updater')

let state: UpdateState = {
  status: supported ? 'idle' : 'disabled',
  version: null,
  progress: null,
  error: null,
  url: null
}

function setState(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  BrowserWindow.getAllWindows()[0]?.webContents.send(UPDATES_IPC.stateChanged, state)
}

// re-checking mid-download restarts the download, and a downloaded update
// needs a restart rather than another check
function checkable(): boolean {
  if (!supported) return false
  if (manual) return state.status !== 'checking'
  return state.status !== 'downloading' && state.status !== 'downloaded'
}

async function checkManually(): Promise<void> {
  setState({ status: 'checking', error: null })
  try {
    const release = await findNewerMacRelease(app.getVersion())
    setState(
      release
        ? { status: 'available', version: release.version, url: release.url }
        : { status: 'up-to-date', version: null, url: null }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('releaseCheck.failed', { error: message })
    setState({ status: 'error', error: message })
  }
}

// failures surface through state (the 'error' event or checkManually), so
// this never rejects
function checkForUpdates(): Promise<unknown> {
  return manual ? checkManually() : autoUpdater.checkForUpdates().catch(() => {})
}

export function registerUpdatesIpc(): void {
  ipcMain.handle(UPDATES_IPC.getState, (): UpdateState => state)
  ipcMain.handle(UPDATES_IPC.check, async (): Promise<UpdateState> => {
    if (checkable()) await checkForUpdates()
    return state
  })
  ipcMain.handle(UPDATES_IPC.quitAndInstall, (): void => {
    if (state.status === 'downloaded') autoUpdater.quitAndInstall()
  })
}

export function startUpdateChecks(): void {
  if (!supported) return
  if (!manual) listenToAutoUpdater()

  // let startup (migrations, first window paint) win the first seconds
  setTimeout(() => void checkForUpdates(), 5_000)
  setInterval(() => {
    if (checkable()) void checkForUpdates()
  }, CHECK_INTERVAL_MS)
}

function listenToAutoUpdater(): void {
  if (testing) autoUpdater.forceDevUpdateConfig = true

  // electron-updater's internals go to the same scrubbed local file; its
  // logger slot accepts our Logger since it only ever passes one argument
  autoUpdater.logger = log

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
}
