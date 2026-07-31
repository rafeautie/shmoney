import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'

const REPO_URL = 'https://github.com/rafeautie/shmoney'

function navigate(to: string): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.appNavigate, to)
}

/**
 * Windows and Linux get no menu at all: the app draws its own title bar with no
 * room for a menu bar, and leaving Electron's default in place means Alt still
 * pops open a stock File/Edit/View menu with "Toggle Developer Tools" in it.
 *
 * macOS always shows a menu bar, so there it has to be a real one. The Edit
 * roles in particular are what make Cmd+X/C/V work in a sandboxed renderer.
 */
export function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => navigate('/settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(is.dev
          ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as const)
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
    {
      role: 'help',
      submenu: [{ label: 'shmoney on GitHub', click: () => shell.openExternal(REPO_URL) }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
