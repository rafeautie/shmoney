import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// A bordered, divided container that groups related settings rows so they read as
// one block. Wrap one or more <SettingToggle>/<SettingAction> rows (used by the
// rules, transfers, privacy, categories, and LLM cards).
export function SettingsGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="divide-y rounded-lg border">{children}</div>
}

// One labelled switch row: label on the left, switch on the right.
export function SettingToggle({
  label,
  checked,
  onCheckedChange
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

// A button-control row that matches the toggle rows: a label (and optional
// description) on the left, and the control(s) passed as children on the right.
export function SettingAction({
  label,
  description,
  children
}: {
  label: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        {/* text-xs to match SettingToggle's Label (this repo's Label is text-xs) */}
        <div className="flex items-center gap-2 text-xs/relaxed">{label}</div>
        {description != null && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
