import { useDetectTransfers } from '@/lib/settings'
import { SettingsGroup, SettingToggle, SettingsSection } from './settings-controls'

export function TransferSettings() {
  const { detectTransfers, setDetectTransfers } = useDetectTransfers()

  return (
    <SettingsSection
      title="Transfers"
      description={
        <>
          Money moved between your own accounts isn&apos;t income or spending. Detected transfers
          are filed under the Transfers category, which reports exclude by default; review or undo
          them from the Activity page.
        </>
      }
    >
      <SettingsGroup>
        <SettingToggle
          label="Detect transfers between accounts on sync"
          checked={detectTransfers}
          onCheckedChange={setDetectTransfers}
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
