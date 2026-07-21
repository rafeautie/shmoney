import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { LlmStatusBadge } from './llm-status-badge'
import { ModelPicker } from './model-picker'

/**
 * Settings card for the on-device model. The whole picker (choose which model
 * is active, download or delete each one, and the hardware-recommended pick)
 * lives in {@link ModelPicker}, shared with onboarding; this just frames it.
 */
export function LlmSettings(): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Local AI model</CardTitle>
        <CardAction>
          <LlmStatusBadge />
        </CardAction>
        <CardDescription>
          Choose the on-device model behind Auto features like auto-categorize and chat. Models
          download once and stay on this device; the one that best fits your hardware is
          recommended. Switch any time, or delete a model to reclaim its disk space.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ModelPicker />
      </CardContent>
    </Card>
  )
}
