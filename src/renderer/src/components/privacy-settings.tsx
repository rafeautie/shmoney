import { usePrivacy } from '@/lib/settings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function PrivacySettings() {
  const { blurAmounts, setBlurAmounts } = usePrivacy()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Privacy</CardTitle>
        <CardDescription>Hide sensitive numbers when someone might be looking.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Switch id="blur-amounts" checked={blurAmounts} onCheckedChange={setBlurAmounts} />
          <Label htmlFor="blur-amounts">Blur dollar amounts</Label>
        </div>
      </CardContent>
    </Card>
  )
}
