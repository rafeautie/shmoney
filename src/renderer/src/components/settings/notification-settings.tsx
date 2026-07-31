import { useNativeNotifications } from '@/lib/settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsGroup, SettingToggle } from './settings-controls'

export function NotificationSettings() {
  const { nativeNotifications, setNativeNotifications } = useNativeNotifications()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notifications</CardTitle>
        <CardDescription>
          Background work always lands in the notification center; this decides whether it also
          reaches you outside the app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsGroup>
          <SettingToggle
            label="Show system notifications while shmoney isn't focused"
            checked={nativeNotifications}
            onCheckedChange={setNativeNotifications}
          />
        </SettingsGroup>
      </CardContent>
    </Card>
  )
}
