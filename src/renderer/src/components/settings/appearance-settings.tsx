import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerIcon, Moon02Icon, Sun02Icon } from '@hugeicons/core-free-icons'
import { UI_SCALES, type UiScale } from '@shared/settings'
import { isMac } from '@/lib/platform'
import { useSettings, useTheme } from '@/lib/settings'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control'
import { SettingAction, SettingsGroup, SettingsSection } from './settings-controls'

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun02Icon },
  { value: 'dark', label: 'Dark', icon: Moon02Icon },
  { value: 'system', label: 'System', icon: ComputerIcon }
] as const

const SCALE_LABELS = Object.fromEntries(
  UI_SCALES.map((scale) => [String(scale), `${Math.round(scale * 100)}%`])
)
const MOD = isMac ? '⌘' : 'Ctrl'

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const { settings, setSetting } = useSettings()

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
        <SettingAction
          label="Interface size"
          description={`Scales all text and spacing. ${MOD} + and ${MOD} − step it, ${MOD} 0 resets.`}
        >
          <Select
            value={String(settings.uiScale)}
            onValueChange={(value) => setSetting('uiScale', Number(value) as UiScale)}
            items={SCALE_LABELS}
          >
            <SelectTrigger aria-label="Interface size" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UI_SCALES.map((scale) => (
                <SelectItem key={scale} value={String(scale)}>
                  {SCALE_LABELS[String(scale)]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingAction>
      </SettingsGroup>
    </SettingsSection>
  )
}
