import { SettingsSection } from './settings-controls'
import { ModelPicker } from '@/components/llm/model-picker'

/**
 * Settings section for the on-device model. The whole picker (choose which model
 * is active, download or delete each one, and the hardware-recommended pick)
 * lives in {@link ModelPicker}, shared with onboarding; this just frames it.
 */
export function LlmSettings(): React.JSX.Element {
  return (
    <SettingsSection
      title="Local AI model"
      description={
        <>
          Choose the on-device model behind Auto features like auto-categorize and chat. Models
          download once and stay on this device; the one that best fits your hardware is
          recommended. Switch any time, or delete a model to reclaim its disk space.
        </>
      }
    >
      <ModelPicker />
    </SettingsSection>
  )
}
