import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SettingsGroup, SettingToggle } from '@/components/settings/settings-controls'
import { useSetSetting, useSetting } from '@/lib/settings'

export function TransactionViewOptionsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const groupByDay = useSetting('groupTransactionsByDay')
  const setSetting = useSetSetting()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>View options</DialogTitle>
          <DialogDescription>How transaction lists look, on every page.</DialogDescription>
        </DialogHeader>
        <SettingsGroup>
          <SettingToggle
            label="Group by day"
            description="Rows sorted by date sit under a header with the day's net."
            checked={groupByDay}
            onCheckedChange={(checked) => void setSetting('groupTransactionsByDay', checked)}
          />
        </SettingsGroup>
      </DialogContent>
    </Dialog>
  )
}

/** The gear beside a transactions page's actions, opening its view options */
export function TransactionViewOptionsButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="View options"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={Settings01Icon} />
      </Button>
      <TransactionViewOptionsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
