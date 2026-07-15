// disabled = a build where auto-update can't work: dev, or unsigned macOS
// (electron-updater requires a code-signed app there)
export type UpdateStatus =
  'disabled' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** version of the available/downloaded update, when known */
  version: string | null
  /** present only while downloading */
  progress: { percent: number; transferred: number; total: number } | null
  /** present only when status is 'error' */
  error: string | null
}

export const UPDATES_IPC = {
  getState: 'updates:getState',
  check: 'updates:check',
  quitAndInstall: 'updates:quitAndInstall',
  stateChanged: 'updates:stateChanged'
} as const
