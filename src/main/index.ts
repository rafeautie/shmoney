// must stay the first import: redirects dev userData before db/index.ts opens
// the database at import time
import './dev-paths'
import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initLogging, createLogger } from './logging'
import { runMigrations } from './db'
import { backupBeforeMigrations, startDailyBackups } from './backups'
import { registerConnectionsIpc } from './ipc/connections'
import { registerCategoriesIpc } from './ipc/categories'
import { registerTransactionsIpc } from './ipc/transactions'
import { purgeStaleUndoneEntries, registerActionLogIpc } from './ipc/action-log'
import { registerReportsIpc } from './ipc/reports'
import { registerBudgetsIpc } from './ipc/budgets'
import { purgeDeletedSavedFilters, registerSavedFiltersIpc } from './ipc/saved-filters'
import { purgeDeletedGoals, registerGoalsIpc } from './ipc/goals'
import { registerRulesIpc } from './ipc/rules'
import { healAcceptedSuggestionsOnLaunch, registerRuleSuggestionsIpc } from './ipc/rule-suggestions'
import { registerSettingsIpc } from './ipc/settings'
import { registerStorageIpc } from './ipc/storage'
import { registerImportIpc } from './ipc/import'
import { registerLlmIpc } from './ipc/llm'
import { registerChatIpc } from './ipc/chat'
import { purgeDeletedConversations, recoverAbandonedTurns } from './llm/features/chat'
import { registerUpdatesIpc, startUpdateChecks } from './ipc/updates'
import { registerLogIpc } from './ipc/log'
import { registerDiagnosticsIpc } from './ipc/diagnostics'
import { registerDebugIpc } from './ipc/debug'
import { registerDemoIpc } from './ipc/demo'
import { registerAppIpc } from './ipc/app'
import { initChromeTheme, resolvedChrome, USES_TITLE_BAR_OVERLAY } from './chrome-theme'
import { sendImportFile, statementPathFrom } from './file-open'
import { installApplicationMenu } from './menu'
import { readSettings } from './settings-store'
import { loadWindowState, trackWindowState } from './window-state'
import { IPC } from '@shared/ipc'
import { TITLE_BAR_OVERLAY_HEIGHT } from '@shared/theme'
import icon from '../../build/icon.png?asset'

// before anything else can log or crash: dev-paths (hoisted above) has already
// redirected userData, so the file transport lands in the right logs dir
initLogging()
const log = createLogger('app')

// how long after the first paint to wait for the renderer's first real screen
// before showing the window anyway
const SHOW_FALLBACK_MS = 2_000

// macOS delivers open-file before the window exists, so park the path until
// createWindow can attach it
let pendingImportFile: string | null = null

function createWindow(): void {
  const state = loadWindowState()
  const chrome = resolvedChrome()

  const mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    // painted before the renderer's first frame; without it the window is born
    // Chromium white and flashes until React mounts and applies the theme
    backgroundColor: chrome.background,
    titleBarStyle: 'hidden',
    // Windows/Linux draw real caption buttons here, which is what gives Windows
    // 11 its Snap Layouts flyout; macOS positions its traffic lights instead
    ...(USES_TITLE_BAR_OVERLAY
      ? {
          titleBarOverlay: {
            color: chrome.background,
            symbolColor: chrome.symbol,
            height: TITLE_BAR_OVERLAY_HEIGHT
          }
        }
      : { trafficLightPosition: { x: 16, y: 16 } }),
    // packaged Windows/macOS builds take the icon from the executable;
    // this covers dev mode and Linux
    icon,
    webPreferences: {
      // sandboxed preloads cannot use ESM, so the preload is built as CJS
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  trackWindowState(mainWindow)

  // shown once the renderer reports its first real screen rather than at first
  // paint, which is only the blank backdrop; ready-to-show stays the floor and
  // the fallback covers a renderer that never reports
  let painted = false
  let rendered = false
  let shown = false
  const showIfReady = (): void => {
    if (shown || !painted || !rendered || mainWindow.isDestroyed()) return
    shown = true
    // maximize() also shows a hidden window, so it waits for this moment too
    if (state.maximized) mainWindow.maximize()
    mainWindow.show()
  }
  mainWindow.webContents.ipc.on(IPC.appReady, () => {
    rendered = true
    showIfReady()
  })
  mainWindow.once('ready-to-show', () => {
    painted = true
    showIfReady()
    setTimeout(() => {
      rendered = true
      showIfReady()
    }, SHOW_FALLBACK_MS)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // only hand real web links to the OS, never file:/custom-protocol URLs
    if (details.url.startsWith('https://')) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The app is a local SPA; the page itself must never navigate anywhere else
  // (dev-server reloads in dev, same-URL reloads in production are the exceptions).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
    const allowed = devUrl ? url.startsWith(devUrl) : url === mainWindow.webContents.getURL()
    if (!allowed) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // launched by double-clicking an associated statement file: the renderer has
  // to exist before it can be handed anything, hence did-finish-load
  const launchFile = pendingImportFile ?? statementPathFrom(process.argv)
  pendingImportFile = null
  if (launchFile) {
    mainWindow.webContents.once('did-finish-load', () => sendImportFile(mainWindow, launchFile))
  }
}

// single instance: a second launch exits immediately and hands focus to the
// running one — two instances would race on the SQLite file, and NSIS can't
// cleanly replace a running app during an update
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // opening an associated file while the app runs arrives here as a second
  // launch, with the path on that launch's command line
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      const filePath = statementPathFrom(argv)
      if (filePath) sendImportFile(win, filePath)
    }
  })

  // macOS route for the same thing; can fire before the window is ready
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.focus()
      sendImportFile(win, filePath)
    } else {
      pendingImportFile = filePath
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.shmoney.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // process crashes are the bug-report class logs exist for; errorHandler
    // only covers exceptions in the main process itself
    app.on('render-process-gone', (_event, _webContents, details) => {
      log.error('render-process-gone', undefined, {
        reason: details.reason,
        exitCode: details.exitCode
      })
    })
    app.on('child-process-gone', (_event, details) => {
      log.error('child-process-gone', undefined, {
        processType: details.type,
        reason: details.reason,
        exitCode: details.exitCode
      })
    })

    await backupBeforeMigrations()
    runMigrations()
    registerConnectionsIpc()
    registerCategoriesIpc()
    registerTransactionsIpc()
    registerActionLogIpc()
    registerReportsIpc()
    registerBudgetsIpc()
    registerSavedFiltersIpc()
    registerGoalsIpc()
    registerRulesIpc()
    registerRuleSuggestionsIpc()
    registerSettingsIpc()
    registerStorageIpc()
    registerImportIpc()
    registerAppIpc()
    registerLlmIpc()
    registerChatIpc()
    registerUpdatesIpc()
    registerLogIpc()
    registerDiagnosticsIpc()
    // dev-only diagnostics and sample data for the Debug page; never registered
    // in production builds
    if (is.dev) {
      registerDebugIpc()
      registerDemoIpc()
    }

    // both read settings, so they have to follow runMigrations
    initChromeTheme(readSettings().theme)
    installApplicationMenu()

    createWindow()

    // startup maintenance runs while the renderer loads its bundle; it's
    // synchronous, so it still finishes before any renderer IPC is served
    purgeStaleUndoneEntries()
    purgeDeletedGoals()
    purgeDeletedSavedFilters()
    recoverAbandonedTurns()
    purgeDeletedConversations()
    healAcceptedSuggestionsOnLaunch()

    startUpdateChecks()
    startDailyBackups()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// single-window app: closing the window quits on macOS too, instead of the
// default of lingering in the dock
app.on('window-all-closed', () => {
  app.quit()
})
