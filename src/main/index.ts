import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { runMigrations } from './db'
import { registerConnectionsIpc } from './ipc/connections'
import { registerCategoriesIpc } from './ipc/categories'
import { registerTransactionsIpc } from './ipc/transactions'
import { registerActionLogIpc } from './ipc/action-log'
import { registerReportsIpc } from './ipc/reports'
import { registerBudgetsIpc } from './ipc/budgets'
import { registerSavedFiltersIpc } from './ipc/saved-filters'
import { registerRulesIpc } from './ipc/rules'
import { registerRuleSuggestionsIpc } from './ipc/rule-suggestions'
import { registerSettingsIpc } from './ipc/settings'
import { registerImportIpc } from './ipc/import'
import { registerWindowIpc } from './ipc/window'
import { registerLlmIpc } from './ipc/llm'
import { registerDebugIpc } from './ipc/debug'
import { IPC } from '@shared/ipc'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      // sandboxed preloads cannot use ESM, so the preload is built as CJS
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send(IPC.windowMaximizedChanged, true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send(IPC.windowMaximizedChanged, false)
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
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.shmoney.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  runMigrations()
  registerConnectionsIpc()
  registerCategoriesIpc()
  registerTransactionsIpc()
  registerActionLogIpc()
  registerReportsIpc()
  registerBudgetsIpc()
  registerSavedFiltersIpc()
  registerRulesIpc()
  registerRuleSuggestionsIpc()
  registerSettingsIpc()
  registerImportIpc()
  registerWindowIpc()
  registerLlmIpc()
  // dev-only diagnostics for the Debug page; never registered in production builds
  if (is.dev) registerDebugIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
