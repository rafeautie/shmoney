import { useState, type ComponentProps, type ReactNode } from 'react'
import { useRowExpanded } from '@/components/data-table-row-expanded'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * A table cell's popover whose base-ui Root mounts on first open; until then
 * the cell is a plain button, so long tables don't carry a closed popover per row.
 */
export function CellPopover({
  open,
  onOpenChange,
  trigger,
  label,
  contentClassName,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** props for the trigger Button */
  trigger: ComponentProps<typeof Button>
  label: ReactNode
  contentClassName?: string
  /** the popover content */
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useRowExpanded(open)

  if (!mounted) {
    return (
      <Button
        {...trigger}
        aria-haspopup="dialog"
        aria-expanded={false}
        onClick={(event) => {
          trigger.onClick?.(event)
          onOpenChange(true)
        }}
      >
        {label}
      </Button>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button {...trigger} />}>{label}</PopoverTrigger>
      <PopoverContent className={contentClassName} align="start">
        {children}
      </PopoverContent>
    </Popover>
  )
}
