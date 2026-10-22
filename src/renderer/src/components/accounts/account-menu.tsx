import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, PencilEdit02Icon, Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NameDialog } from '@/components/name-dialog'
import { TransactionViewItems } from '@/components/transactions/view-options'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * The account page's gear: a menu of per-account actions and the table's view
 * toggles. Rename and delete each open a dialog.
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
  const [editing, setEditing] = useState(false)
  const rename = useMutation({
    meta: { silenceError: true },
    mutationFn: (name: string) => window.api.accounts.rename(accountId, name),
    // the name shows up on transactions, filters and reports too
    onSuccess: () => queryClient.invalidateQueries()
  })
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
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit02Icon} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            <HugeiconsIcon icon={Delete02Icon} />
            Delete account…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <TransactionViewItems />
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={editing}
        onOpenChange={setEditing}
        title="Rename account"
        // balances and currency come from the bank or the import, so the name
        // is the one field set here
        description="The name shows wherever this account appears in shmoney."
        name={accountName}
        onSave={(name) => rename.mutateAsync(name)}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
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
      />
    </>
  )
}
