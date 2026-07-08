import { usePrivacy } from '@/lib/settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsGroup, SettingToggle } from './settings-controls'

export function PrivacySettings() {
  const { blurAmounts, setBlurAmounts } = usePrivacy()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Privacy</CardTitle>
        <CardDescription>Hide sensitive numbers when someone might be looking.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsGroup>
          <SettingToggle label="Blur amounts" checked={blurAmounts} onCheckedChange={setBlurAmounts} />
        </SettingsGroup>
      </CardContent>
    </Card>
  )
}
