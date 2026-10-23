import { HugeiconsIcon } from '@hugeicons/react'
import { SlidersHorizontalIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useSetSetting, useSetting } from '@/lib/settings'

/** The transaction tables' view toggles */
export function TransactionViewItems() {
  const groupByDay = useSetting('groupTransactionsByDay')
  const setSetting = useSetSetting()
  return (
    <DropdownMenuSwitchItem
      checked={groupByDay}
      onCheckedChange={(checked) => void setSetting('groupTransactionsByDay', checked)}
    >
      Group by Day
    </DropdownMenuSwitchItem>
  )
}

/** The transaction tables' view toggles, on the Accounts page and each account page */
export function TransactionViewOptionsButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" className="shrink-0" />}
        aria-label="View Options"
      >
        <HugeiconsIcon icon={SlidersHorizontalIcon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <TransactionViewItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
