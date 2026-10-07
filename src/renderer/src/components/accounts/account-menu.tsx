import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Delete02Icon,
  PencilEdit02Icon,
  Settings01Icon,
  SlidersHorizontalIcon
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TransactionViewOptionsDialog } from '@/components/transactions/view-options'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * The account page's gear: a menu of per-account actions and the view options. Rename hands off to
 * the page title (AccountName), which edits in place; delete opens one confirm.
 */
export function AccountMenuButton({
  accountId,
  accountName,
  isManual,
  onRename
}: {
  accountId: number
  accountName: string
  isManual: boolean
  onRename: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  // focus goes to the name field on Rename, so the closing menu mustn't pull it
  // back to the gear (that blur would end the edit at once)
  const renamePicked = useRef(false)
  const deleteAccount = useMutation({
    mutationFn: () => window.api.accounts.delete(accountId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      await navigate({ to: '/accounts' })
    }
  })

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && (renamePicked.current = false)}>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" className="shrink-0" />}
          aria-label="Account actions"
        >
          <HugeiconsIcon icon={Settings01Icon} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" finalFocus={() => !renamePicked.current}>
          <DropdownMenuItem
            onClick={() => {
              renamePicked.current = true
              onRename()
            }}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOptionsOpen(true)}>
            <HugeiconsIcon icon={SlidersHorizontalIcon} />
            View options…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            <HugeiconsIcon icon={Delete02Icon} />
            Delete account…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TransactionViewOptionsDialog open={optionsOpen} onOpenChange={setOptionsOpen} />
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

/** The account page title, which becomes a name field while `editing`: Enter or
 *  blur saves, Escape cancels, and an empty or unchanged name is a no-op. */
export function AccountName({
  accountId,
  name,
  editing,
  onDone
}: {
  accountId: number
  name: string
  editing: boolean
  onDone: () => void
}) {
  if (!editing) {
    return <h2 className="text-2xl font-semibold tracking-tight select-text">{name}</h2>
  }
  // mounted per edit, so the draft starts from the current name each time
  return <NameField accountId={accountId} name={name} onDone={onDone} />
}

function NameField({
  accountId,
  name,
  onDone
}: {
  accountId: number
  name: string
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(name)
  // Enter commits and the field then blurs; only the first one counts
  const settled = useRef(false)
  const rename = useMutation({
    mutationFn: (next: string) => window.api.accounts.rename(accountId, next),
    // the name shows up on transactions, filters and reports too
    onSuccess: () => queryClient.invalidateQueries(),
    onSettled: onDone
  })

  const finish = (save: boolean): void => {
    if (settled.current) return
    settled.current = true
    const next = draft.trim()
    if (save && next !== '' && next !== name) rename.mutate(next)
    else onDone()
  }
  const commit = (): void => finish(true)

  return (
    <Input
      aria-label="Account name"
      autoFocus
      // select the old name so typing replaces it
      onFocus={(e) => e.currentTarget.select()}
      value={draft}
      maxLength={200}
      disabled={rename.isPending}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') finish(false)
      }}
      // sized and offset so the name keeps the heading's line and position
      className="-ml-2.5 h-8 w-80 text-2xl font-semibold tracking-tight md:text-2xl"
    />
  )
}
