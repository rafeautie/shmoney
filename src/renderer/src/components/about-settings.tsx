import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LicensesDialog } from './licenses-dialog'
import { SettingsGroup, SettingAction } from './settings-controls'

export function AboutSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About</CardTitle>
        <CardDescription>v{__APP_VERSION__}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsGroup>
          <SettingAction
            label="Open source licenses"
            description="The open source software shmoney is built with."
          >
            <LicensesDialog />
          </SettingAction>
        </SettingsGroup>
      </CardContent>
    </Card>
  )
}
