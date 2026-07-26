import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/confirm-dialog'
import { SettingsGroup, SettingAction } from '@/components/settings/settings-controls'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

interface AccountSettingsProps {
  accountId: number
  accountName: string
  isManual: boolean
}

/**
 * Per-account settings and actions. Synced accounts can't be deleted here — the
 * next sync would just recreate them — so the dialog explains that instead.
 */
export function AccountSettingsDialog({
  accountId,
  accountName,
  isManual,
  open,
  onOpenChange
}: AccountSettingsProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const deleteAccount = useMutation({
    mutationFn: () => window.api.accounts.delete(accountId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      await navigate({ to: '/accounts' })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Settings and actions for this account.</DialogDescription>
        </DialogHeader>
        <div>
          <SettingsGroup>
            <SettingAction
              label="Delete account"
              description={
                isManual
                  ? 'Permanently removes this account and all of its transactions and holdings.'
                  : 'Synced accounts return on the next sync; disconnect SimpleFIN to remove them.'
              }
            >
              <ConfirmButton
                variant="destructive"
                disabled={!isManual}
                title={`Delete “${accountName}”?`}
                description="This permanently deletes the account and all of its transactions and holdings. This cannot be undone."
                confirmLabel="Delete account"
                pendingLabel="Deleting…"
                pending={deleteAccount.isPending}
                onConfirm={() => deleteAccount.mutate()}
              >
                Delete
              </ConfirmButton>
            </SettingAction>
          </SettingsGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The account-settings dialog and the gear button that opens it. */
export function AccountSettingsButton(props: AccountSettingsProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="Account settings"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={Settings01Icon} />
      </Button>
      <AccountSettingsDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  )
}
