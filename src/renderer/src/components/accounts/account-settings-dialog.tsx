import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

/** Per-account settings and actions: rename and delete. */
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
  const [name, setName] = useState(accountName)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the draft each time the dialog opens
    if (open) setName(accountName)
  }, [open, accountName])
  const rename = useMutation({
    mutationFn: (next: string) => window.api.accounts.rename(accountId, next),
    // the name shows up on transactions, filters and reports too
    onSuccess: () => queryClient.invalidateQueries()
  })
  const commitName = (): void => {
    const next = name.trim()
    if (next === '' || next === accountName) {
      setName(accountName)
      return
    }
    rename.mutate(next)
  }

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
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <Label htmlFor="account-name" className="shrink-0">
                Name
              </Label>
              <Input
                id="account-name"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName()
                  if (e.key === 'Escape') setName(accountName)
                }}
                className="max-w-64"
              />
            </div>
            <SettingAction
              label="Delete account"
              description={
                isManual
                  ? 'Permanently removes this account and all of its transactions and holdings.'
                  : 'Permanently removes this account and its history. Later syncs skip it.'
              }
            >
              <ConfirmButton
                variant="destructive"
                title={`Delete “${accountName}”?`}
                description={
                  isManual
                    ? 'This permanently deletes the account and all of its transactions and holdings. This cannot be undone.'
                    : 'This permanently deletes the account and all of its transactions and holdings, and future syncs will no longer import it. This cannot be undone.'
                }
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
