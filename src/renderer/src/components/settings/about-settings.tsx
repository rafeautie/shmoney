import type { UpdateState } from '@shared/updates'
import { Button } from '@/components/ui/button'
import { useUpdateState } from '@/lib/updates'
import { featureRequestUrl } from '@/lib/github'
import { isDemo } from '@/lib/platform'
import { useSettingsDialog } from '@/lib/settings-dialog'
import { LicensesPage } from './licenses-page'
import { ReportBugPage } from './report-bug-page'
import { SettingsGroup, SettingAction, SettingsSection } from './settings-controls'

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
    case 'available':
      return `v${state.version} is available. Download it from GitHub to update.`
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
  const downloadUrl = state?.status === 'available' ? state.url : null
  return (
    <SettingAction label="Updates" description={updateStatusLine(state)}>
      {state?.status === 'downloaded' ? (
        <Button onClick={() => void window.api.updates.quitAndInstall()}>Restart to update</Button>
      ) : downloadUrl ? (
        // window.open on an https URL goes to the OS browser (see main/index.ts)
        <Button onClick={() => window.open(downloadUrl)}>Download update</Button>
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

export function AboutSettings() {
  const { page, open } = useSettingsDialog()
  const back = (): void => open('about')
  if (page === 'licenses') return <LicensesPage onBack={back} />
  if (page === 'report-bug') return <ReportBugPage onBack={back} />

  return (
    <SettingsSection title="About" description={`v${__APP_VERSION__}`}>
      <SettingsGroup>
        {!isDemo && <UpdatesRow />}
        <SettingAction
          label="Open source licenses"
          description="The open source software shmoney is built with."
        >
          <Button variant="outline" onClick={() => open('about', 'licenses')}>
            View licenses
          </Button>
        </SettingAction>
        <SettingAction
          label="Report a bug"
          description="Review your diagnostics, then open a prefilled GitHub issue. Nothing is sent without your say-so."
        >
          <Button variant="outline" onClick={() => open('about', 'report-bug')}>
            Report bug
          </Button>
        </SettingAction>
        {/* window.open on an https URL routes through setWindowOpenHandler to
            the OS browser (see main/index.ts) */}
        <SettingAction
          label="Request a feature"
          description="Suggest an improvement or a new idea on GitHub."
        >
          <Button variant="outline" onClick={() => window.open(featureRequestUrl())}>
            Request feature
          </Button>
        </SettingAction>
      </SettingsGroup>
    </SettingsSection>
  )
}
