import { useId } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// One titled block within a settings dialog section, with an optional action
// (e.g. a button) beside the heading.
export function SettingsSection({
  title,
  description,
  action,
  children
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="font-heading text-base font-medium">{title}</h3>
          {description != null && (
            <p className="text-xs/relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// A page opened from within a section (licenses, a preview, suggestions): it
// takes over the pane, with a breadcrumb back to the section instead of a
// dialog stacked over Settings.
export function SettingsSubpage({
  parent,
  title,
  description,
  action,
  onBack,
  children
}: {
  parent: string
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  onBack: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <nav aria-label="Breadcrumb" className="-ml-1.5 flex items-center gap-1 text-base">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Back to ${parent}`}
              onClick={onBack}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
            </Button>
            <button
              type="button"
              onClick={onBack}
              className="font-heading font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
            >
              {parent}
            </button>
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5 text-muted-foreground" />
            <h3 className="font-heading font-medium">{title}</h3>
          </nav>
          {description != null && (
            <p className="text-xs/relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// A bordered, divided container that groups related settings rows so they read as
// one block. Wrap one or more <SettingToggle>/<SettingAction> rows (used by the
// rules, transfers, privacy, categories, and LLM cards).
export function SettingsGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="divide-y rounded-lg border">{children}</div>
}

// One labelled switch row: label (and optional description) on the left, switch
// on the right.
export function SettingToggle({
  label,
  description,
  checked,
  onCheckedChange
}: {
  label: string
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {description != null && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
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
