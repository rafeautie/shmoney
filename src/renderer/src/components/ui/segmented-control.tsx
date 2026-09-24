import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'

import { cn } from '@/lib/utils'

// A radio group drawn as a row of pill buttons, for picking one of a few options
// that are all worth seeing at once. Arrow keys move the selection.
function SegmentedControl<Value extends string>({
  className,
  onValueChange,
  ...props
}: Omit<RadioGroup.Props<Value>, 'onValueChange'> & {
  onValueChange?: (value: Value) => void
}) {
  return (
    <RadioGroup
      data-slot="segmented-control"
      className={cn(
        'inline-flex h-8 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground',
        className
      )}
      onValueChange={(value) => onValueChange?.(value as Value)}
      {...props}
    />
  )
}

function SegmentedControlItem({ className, ...props }: Radio.Root.Props) {
  return (
    <Radio.Root
      data-slot="segmented-control-item"
      className={cn(
        'inline-flex h-full flex-1 cursor-default items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-[color,box-shadow] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm data-disabled:pointer-events-none data-disabled:opacity-50 dark:data-checked:border-input dark:data-checked:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlItem }
