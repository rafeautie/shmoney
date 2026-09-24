// disabled = a dev build, where updates never run. available = macOS only: a
// newer release exists but must be downloaded by hand, since electron-updater
// can't install on an unsigned Mac app
export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** version of the available/downloaded update, when known */
  version: string | null
  /** present only while downloading */
  progress: { percent: number; transferred: number; total: number } | null
  /** present only when status is 'error' */
  error: string | null
  /** present only when status is 'available': the release page to download from */
  url: string | null
}

export const UPDATES_IPC = {
  getState: 'updates:getState',
  check: 'updates:check',
  quitAndInstall: 'updates:quitAndInstall',
  stateChanged: 'updates:stateChanged'
} as const
