import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * The account page's gear: a menu of per-account actions. Synced accounts
 * can't be deleted here (the next sync would just recreate them), so the item
 * stays disabled and says why.
 */
export function AccountMenuButton({
  accountId,
  accountName,
  isManual
}: {
  accountId: number
  accountName: string
  isManual: boolean
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deleteAccount = useMutation({
    mutationFn: () => window.api.accounts.delete(accountId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      await navigate({ to: '/accounts' })
    }
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" className="shrink-0" />}
          aria-label="Account actions"
        >
          <HugeiconsIcon icon={Settings01Icon} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            variant="destructive"
            disabled={!isManual}
            onClick={() => setConfirmOpen(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} />
            Delete account…
          </DropdownMenuItem>
          {!isManual && (
            <p className="px-2 pt-0.5 pb-1.5 text-xs text-muted-foreground">
              Synced accounts return on the next sync; disconnect SimpleFIN to remove them.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete “${accountName}”?`}
        description="This permanently deletes the account and all of its transactions and holdings. This cannot be undone."
        confirmLabel="Delete account"
        pendingLabel="Deleting…"
        pending={deleteAccount.isPending}
        onConfirm={() => deleteAccount.mutate()}
      />
    </>
  )
}
