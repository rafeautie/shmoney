import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { AMOUNT_NOISE, cn } from '@/lib/utils'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'

interface NumberInputProps extends Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'prefix' | 'type'
> {
  /** raw text, so callers keep their own parsing/validation */
  value: string
  onValueChange: (value: string) => void
  /** amount added/removed per stepper click, arrow key, or wheel notch */
  step?: number
  /** stepping bounds; omitted = unbounded, for fields that take a signed amount */
  min?: number
  max?: number
  /** short text rendered before the input, e.g. "$" */
  prefix?: string
  /** classes for the input itself; `className` styles the surrounding group */
  inputClassName?: string
}

/** Text input with custom stepper controls in place of the native number
 * spinner. Steps on the arrow keys, the stepper buttons, and the wheel while
 * the pointer is over the field. */
export function NumberInput({
  value,
  onValueChange,
  step = 1,
  min,
  max,
  prefix,
  className,
  inputClassName,
  disabled,
  onKeyDown,
  ref,
  ...props
}: NumberInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  // what the next step builds on. Wheel events arrive faster than React
  // re-renders, so a burst would otherwise all read the same stale `value` and
  // collapse into one step; this carries the running total between renders.
  // Layout effect, not a plain one: it has to land before the next wheel event.
  const latest = React.useRef(value)
  React.useLayoutEffect(() => {
    latest.current = value
  }, [value])

  const nudge = React.useCallback(
    (direction: 1 | -1) => {
      const current = Number(latest.current.replace(AMOUNT_NOISE, ''))
      const base = Number.isFinite(current) ? current : 0
      // cents-safe rounding so repeated steps never accumulate float noise
      let next = Math.round((base + direction * step) * 100) / 100
      if (min !== undefined) next = Math.max(min, next)
      if (max !== undefined) next = Math.min(max, next)
      latest.current = String(next)
      onValueChange(latest.current)
    },
    [step, min, max, onValueChange]
  )

  // scroll over the field to step it. Bound to the input itself, so it only
  // fires while the pointer is over it, and bound here rather than via onWheel
  // because React registers wheel listeners passively — preventDefault (which
  // stops the page scrolling out from under the pointer) is a no-op there.
  React.useEffect(() => {
    const el = inputRef.current
    if (!el || disabled) return undefined
    function onWheel(event: WheelEvent) {
      if (event.deltaY === 0) return
      event.preventDefault()
      nudge(event.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [disabled, nudge])

  return (
    <InputGroup className={className} data-disabled={disabled || undefined}>
      {prefix !== undefined && (
        <InputGroupAddon>
          <InputGroupText>{prefix}</InputGroupText>
        </InputGroupAddon>
      )}
      <InputGroupInput
        inputMode="decimal"
        className={inputClassName}
        ref={(node) => {
          inputRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
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
        {/* the chevrons carry their own whitespace, so the boxes overlap
            slightly to sit them as one tight pair */}
        <div className="flex flex-col -space-y-0.5">
          <StepperButton
            label="Increase"
            icon={ArrowUp01Icon}
            disabled={disabled}
            onClick={() => nudge(1)}
          />
          <StepperButton
            label="Decrease"
            icon={ArrowDown01Icon}
            disabled={disabled}
            onClick={() => nudge(-1)}
          />
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
        'flex h-2.5 w-4 items-center justify-center rounded-xs text-muted-foreground',
        'hover:text-foreground disabled:pointer-events-none'
      )}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={10} strokeWidth={2.5} />
    </button>
  )
}
