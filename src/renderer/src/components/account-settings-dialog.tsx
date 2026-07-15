import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { SettingsGroup, SettingToggle } from '@/components/settings-controls'
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
 * per-account overrides. Currently a single toggle to invert the balance sign, for
 * institutions that report a negative balance when the account holds positive value.
 */
export function AccountSettingsDialog({
  accountId,
  invertBalance
}: {
  accountId: number
  invertBalance: boolean
}) {
  const queryClient = useQueryClient()
  const setInvert = useMutation({
    mutationFn: (next: boolean) =>
      window.api.accounts.setInvertBalance({ accountId, invertBalance: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] })
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
          <DialogDescription>Overrides that apply only to this account.</DialogDescription>
        </DialogHeader>
        <div>
          <SettingsGroup>
            <SettingToggle
              label="Invert balance sign"
              checked={invertBalance}
              onCheckedChange={(on) => setInvert.mutate(on)}
            />
          </SettingsGroup>
          <p className="text-muted-foreground mt-2 text-xs">
            Use this when the institution reports a negative balance for an account that holds
            positive value. Only the displayed balance is flipped; transactions are unchanged.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
