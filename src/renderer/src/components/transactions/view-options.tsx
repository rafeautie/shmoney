import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useSetSetting, useSetting } from '@/lib/settings'

/** The transaction tables' view toggles, for any gear menu that lists them */
export function TransactionViewItems() {
  const groupByDay = useSetting('groupTransactionsByDay')
  const setSetting = useSetSetting()
  return (
    <DropdownMenuCheckboxItem
      checked={groupByDay}
      onCheckedChange={(checked) => void setSetting('groupTransactionsByDay', checked)}
    >
      Group by day
    </DropdownMenuCheckboxItem>
  )
}

/** The All transactions page's gear */
export function TransactionViewOptionsButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" className="shrink-0" />}
        aria-label="View options"
      >
        <HugeiconsIcon icon={Settings01Icon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <TransactionViewItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
