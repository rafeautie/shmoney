import { useDetectTransfers } from '@/lib/settings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
        <div className="flex items-center gap-2">
          <Switch
            id="detect-transfers"
            checked={detectTransfers}
            onCheckedChange={setDetectTransfers}
          />
          <Label htmlFor="detect-transfers">Detect transfers between accounts on sync</Label>
        </div>
      </CardContent>
    </Card>
  )
}
