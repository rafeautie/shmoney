import { usePrivacy } from '@/lib/settings'
import { SettingsGroup, SettingToggle, SettingsSection } from './settings-controls'

export function PrivacySettings() {
  const { blurAmounts, setBlurAmounts } = usePrivacy()

  return (
    <SettingsSection
      title="Privacy"
      description="Hide sensitive numbers when someone might be looking."
    >
      <SettingsGroup>
        <SettingToggle
          label="Hide amounts"
          checked={blurAmounts}
          onCheckedChange={setBlurAmounts}
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
