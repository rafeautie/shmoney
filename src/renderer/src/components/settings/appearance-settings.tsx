import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerIcon, Moon02Icon, Sun02Icon } from '@hugeicons/core-free-icons'
import { useTheme } from '@/lib/settings'
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control'
import { SettingAction, SettingsGroup, SettingsSection } from './settings-controls'

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun02Icon },
  { value: 'dark', label: 'Dark', icon: Moon02Icon },
  { value: 'system', label: 'System', icon: ComputerIcon }
] as const

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()

  return (
    <SettingsSection title="Appearance" description="Choose how shmoney looks.">
      <SettingsGroup>
        <SettingAction label="Theme" description="System follows your operating system.">
          <SegmentedControl aria-label="Theme" value={theme} onValueChange={setTheme}>
            {THEMES.map(({ value, label, icon }) => (
              <SegmentedControlItem key={value} value={value}>
                <HugeiconsIcon icon={icon} size={14} />
                {label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </SettingAction>
      </SettingsGroup>
    </SettingsSection>
  )
}
