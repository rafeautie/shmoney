import { useDetectTransfers } from '@/lib/settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsGroup, SettingToggle } from './settings-controls'

export function TransferSettings() {
  const { detectTransfers, setDetectTransfers } = useDetectTransfers()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transfers</CardTitle>
        <CardDescription>
          Money moved between your own accounts isn&apos;t income or spending. Detected transfers are
          excluded from income and expense totals; review or undo them from the Activity page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsGroup>
          <SettingToggle
            label="Detect transfers between accounts on sync"
            checked={detectTransfers}
            onCheckedChange={setDetectTransfers}
          />
        </SettingsGroup>
      </CardContent>
    </Card>
  )
}
