import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NameDialog } from '@/components/name-dialog'

/**
 * An account's "…" menu, on the account page and on each row of the Accounts
 * list. Rename and delete each open a dialog; delete asks first because it
 * can't be undone.
 */
export function AccountActionsMenu({
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
  const onAccountPage = useRouterState({
    select: (state) => state.location.pathname === `/accounts/${accountId}`
  })
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
      if (onAccountPage) await navigate({ to: '/accounts' })
    }
  })

  return (
    <>
      {/* the Accounts list rows open the account on click */}
      <ActionsMenu label="Account Actions" onTriggerClick={(e) => e.stopPropagation()}>
        <ActionsMenuItem icon={PencilEdit01Icon} onClick={() => setEditing(true)}>
          Rename
        </ActionsMenuItem>
        <ActionsMenuItem icon={Delete02Icon} destructive onClick={() => setConfirmOpen(true)}>
          Delete
        </ActionsMenuItem>
      </ActionsMenu>
      <NameDialog
        open={editing}
        onOpenChange={setEditing}
        title="Rename Account"
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
        confirmLabel="Delete Account"
        pendingLabel="Deleting…"
        pending={deleteAccount.isPending}
        onConfirm={() => deleteAccount.mutate()}
      />
    </>
  )
}
