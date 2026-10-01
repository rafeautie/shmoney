import { useNativeNotifications } from '@/lib/settings'
import { SettingsGroup, SettingToggle, SettingsSection } from './settings-controls'

export function NotificationSettings() {
  const { nativeNotifications, setNativeNotifications } = useNativeNotifications()

  return (
    <SettingsSection
      title="Notifications"
      description={
        <>
          Background work always shows as a dot in the sidebar; this decides whether it also reaches
          you outside the app.
        </>
      }
    >
      <SettingsGroup>
        <SettingToggle
          label="Show system notifications while shmoney isn't focused"
          checked={nativeNotifications}
          onCheckedChange={setNativeNotifications}
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
