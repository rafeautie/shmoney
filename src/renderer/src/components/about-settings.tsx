import type { UpdateState } from '@shared/updates'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUpdateState } from '@/lib/updates'
import { LicensesDialog } from './licenses-dialog'
import { SettingsGroup, SettingAction } from './settings-controls'

function updateStatusLine(state: UpdateState | undefined): string {
  switch (state?.status) {
    case 'disabled':
      return 'Automatic updates are disabled in development builds.'
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return state.progress
        ? `Downloading v${state.version}… ${Math.round(state.progress.percent)}%`
        : `Downloading v${state.version}…`
    case 'downloaded':
      return `v${state.version} ready — restart to install.`
    case 'up-to-date':
      return "You're on the latest version."
    case 'error':
      return "Couldn't check for updates."
    default:
      return 'shmoney checks for updates automatically.'
  }
}

function UpdatesRow() {
  const state = useUpdateState().data
  const busy = state?.status === 'checking' || state?.status === 'downloading'
  return (
    <SettingAction label="Updates" description={updateStatusLine(state)}>
      {state?.status === 'downloaded' ? (
        <Button onClick={() => void window.api.updates.quitAndInstall()}>Restart to update</Button>
      ) : (
        <Button
          variant="outline"
          disabled={busy || state?.status === 'disabled'}
          onClick={() => void window.api.updates.check()}
        >
          Check for updates
        </Button>
      )}
    </SettingAction>
  )
}

// deep-link into the repo's issue forms (.github/ISSUE_TEMPLATE): GitHub
// prefills any form field whose id matches a query param
function issueUrl(params: Record<string, string>): string {
  return `https://github.com/rafeautie/shmoney/issues/new?${new URLSearchParams(params)}`
}

function bugReportUrl(): string {
  const ua = navigator.userAgent
  // must match the bug form's os dropdown options exactly
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : 'Linux'
  return issueUrl({ template: 'bug_report.yml', version: __APP_VERSION__, os })
}

function featureRequestUrl(): string {
  return issueUrl({ template: 'feature_request.yml' })
}

export function AboutSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About</CardTitle>
        <CardDescription>v{__APP_VERSION__}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsGroup>
          <UpdatesRow />
          <SettingAction
            label="Open source licenses"
            description="The open source software shmoney is built with."
          >
            <LicensesDialog />
          </SettingAction>
          {/* window.open on an https URL routes through setWindowOpenHandler to
              the OS browser (see main/index.ts) */}
          <SettingAction
            label="Report a bug"
            description="Opens a GitHub issue prefilled with your version and system info."
          >
            <Button variant="outline" onClick={() => window.open(bugReportUrl())}>
              Report bug
            </Button>
          </SettingAction>
          <SettingAction
            label="Request a feature"
            description="Suggest an improvement or a new idea on GitHub."
          >
            <Button variant="outline" onClick={() => window.open(featureRequestUrl())}>
              Request feature
            </Button>
          </SettingAction>
        </SettingsGroup>
      </CardContent>
    </Card>
  )
}
