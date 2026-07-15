import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SettingsGroup, SettingAction, SettingToggle } from '@/components/settings-controls'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'

/**
 * Header action on the account detail page: a gear button that opens a dialog of
 * per-account overrides. Holds the invert-balance toggle and, for manual accounts,
 * a delete action. Synced accounts can't be deleted here — the next sync would
 * just recreate them — so the dialog explains that instead.
 */
export function AccountSettingsDialog({
  accountId,
  accountName,
  isManual,
  invertBalance
}: {
  accountId: number
  accountName: string
  isManual: boolean
  invertBalance: boolean
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const setInvert = useMutation({
    mutationFn: (next: boolean) =>
      window.api.accounts.setInvertBalance({ accountId, invertBalance: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] })
  })
  const deleteAccount = useMutation({
    mutationFn: () => window.api.accounts.delete(accountId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      await navigate({ to: '/accounts' })
    }
  })

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0" aria-label="Account settings">
          <HugeiconsIcon icon={Settings01Icon} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Settings and actions for this account.</DialogDescription>
        </DialogHeader>
        <div>
          <SettingsGroup>
            <SettingToggle
              label="Invert balance sign"
              description="Flips the displayed balance when the institution reports it with the wrong sign; transactions are unchanged."
              checked={invertBalance}
              onCheckedChange={(on) => setInvert.mutate(on)}
            />
            <SettingAction
              label="Delete account"
              description={
                isManual
                  ? 'Permanently removes this account and all of its transactions and holdings.'
                  : 'Synced accounts return on the next sync; disconnect SimpleFIN to remove them.'
              }
            >
              <Button
                variant="destructive"
                disabled={!isManual}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </SettingAction>
          </SettingsGroup>
        </div>
        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title={`Delete “${accountName}”?`}
          description="This permanently deletes the account and all of its transactions and holdings. This cannot be undone."
          confirmLabel="Delete account"
          pendingLabel="Deleting…"
          pending={deleteAccount.isPending}
          onConfirm={() => deleteAccount.mutate()}
        />
      </DialogContent>
    </Dialog>
  )
}
