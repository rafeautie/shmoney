import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'

interface NumberInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'prefix' | 'type'> {
  /** raw text, so callers keep their own parsing/validation */
  value: string
  onValueChange: (value: string) => void
  /** amount added/removed by the stepper controls and arrow keys */
  step?: number
  min?: number
  /** short text rendered before the input, e.g. "$" */
  prefix?: string
}

/** Text input with custom stepper controls in place of the native number spinner. */
export function NumberInput({
  value,
  onValueChange,
  step = 1,
  min = 0,
  prefix,
  className,
  disabled,
  onKeyDown,
  ...props
}: NumberInputProps) {
  function nudge(direction: 1 | -1) {
    const current = Number(value.replace(/[$,\s]/g, ''))
    const base = Number.isFinite(current) ? current : 0
    // cents-safe rounding so repeated steps never accumulate float noise
    const next = Math.max(min, Math.round((base + direction * step) * 100) / 100)
    onValueChange(String(next))
  }

  return (
    <InputGroup className={className} data-disabled={disabled || undefined}>
      {prefix !== undefined && (
        <InputGroupAddon>
          <InputGroupText>{prefix}</InputGroupText>
        </InputGroupAddon>
      )}
      <InputGroupInput
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            nudge(1)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            nudge(-1)
          }
          onKeyDown?.(e)
        }}
        {...props}
      />
      <InputGroupAddon align="inline-end" className="cursor-default gap-0 py-0 pr-1">
        <div className="flex flex-col">
          <StepperButton label="Increase" icon={ArrowUp01Icon} disabled={disabled} onClick={() => nudge(1)} />
          <StepperButton label="Decrease" icon={ArrowDown01Icon} disabled={disabled} onClick={() => nudge(-1)} />
        </div>
      </InputGroupAddon>
    </InputGroup>
  )
}

function StepperButton({
  label,
  icon,
  disabled,
  onClick
}: {
  label: string
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon']
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      // the input stays the focus target; arrow keys step it from the keyboard.
      // preventDefault keeps a click from stealing focus, so consumers that
      // commit on blur (e.g. inline table editors) don't commit mid-step
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      aria-label={label}
      disabled={disabled}
      data-slot="number-input-stepper"
      className={cn(
        'flex h-3 w-4 items-center justify-center rounded-xs text-muted-foreground',
        'hover:text-foreground disabled:pointer-events-none'
      )}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={10} strokeWidth={2.5} />
    </button>
  )
}
