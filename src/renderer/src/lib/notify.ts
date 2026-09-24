import { toast } from 'sonner'

export interface NotifyOptions {
  description?: string
  action?: { label: string; onClick: () => void }
}

/**
 * Feedback for something the user just did: a toast, mirrored to an OS
 * notification (main shows that only while the window is unfocused).
 * Background news goes through notifyOs instead; the sidebar dots carry it in-app.
 */
export function notify(title: string, options: NotifyOptions = {}): void {
  toast(title, options)
  notifyOs(title, options.description)
}

notify.error = (title: string, options: NotifyOptions = {}): void => {
  toast.error(title, options)
  notifyOs(title, options.description)
}

/** OS notification only, for work that finished in the background. */
export function notifyOs(title: string, description = ''): void {
  window.api.app.notify(title, description)
}
