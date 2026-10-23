import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * The one way an item offers its actions: a ghost "…" button opening a menu.
 * Goals, envelopes, transactions, accounts, reports, widgets, categories and
 * rules all use it, so the same button means the same thing everywhere. Items
 * are `ActionsMenuItem`s; dialogs they open live beside the menu, not in it.
 */
export function ActionsMenu({
  label,
  size = 'icon',
  className,
  align = 'end',
  onTriggerClick,
  children
}: {
  /** accessible name, e.g. "Goal Actions" */
  label: string
  size?: 'icon' | 'icon-sm' | 'icon-xs'
  className?: string
  align?: 'start' | 'end'
  /** e.g. stop a click from reaching a clickable card underneath */
  onTriggerClick?: (event: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            className={cn('shrink-0', className)}
            onClick={onTriggerClick}
          />
        }
        aria-label={label}
      >
        <HugeiconsIcon
          icon={MoreHorizontalIcon}
          className={size === 'icon-xs' ? 'size-3.5' : 'size-4'}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-auto min-w-40"
        // menus inside clickable cards must not open the card
        onClick={onTriggerClick ? (event) => event.stopPropagation() : undefined}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ActionsMenuItem({
  icon,
  destructive = false,
  disabled,
  onClick,
  children
}: {
  icon: IconSvgElement
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <DropdownMenuItem
      variant={destructive ? 'destructive' : 'default'}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={14} />
      {children}
    </DropdownMenuItem>
  )
}
