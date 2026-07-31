import { BrowserWindow, Notification } from 'electron'
import { readSettings } from './settings-store'

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

/**
 * Taskbar (Windows) / dock (macOS) progress for work the user started and then
 * walked away from: the multi-GB model download, a sync, a categorize run.
 * Pass null when the work ends, which clears the indicator.
 */
export function setTaskbarProgress(fraction: number | null): void {
  // -1 is Electron's "no progress bar"; anything in 0..1 draws one
  mainWindow()?.setProgressBar(fraction === null ? -1 : Math.min(Math.max(fraction, 0), 1))
}

/**
 * OS notification for background work that finished while the user was
 * elsewhere. Deliberately silent when the window is focused: the in-app
 * notification center already covers that case, and a toast for something
 * you are looking at is noise.
 */
export function notifyOs(title: string, body: string): void {
  const window = mainWindow()
  if (window?.isFocused()) return
  if (!Notification.isSupported()) return
  if (!readSettings().nativeNotifications) return

  const notification = new Notification({ title, body })
  notification.on('click', () => {
    const target = mainWindow()
    if (!target) return
    if (target.isMinimized()) target.restore()
    target.focus()
  })
  notification.show()
}
