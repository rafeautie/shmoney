import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { Transaction } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { CategoryPicker } from '@/components/category-picker'
import { plural } from '@/lib/utils'

interface TransactionsBulkActionsProps {
  /** The selected transactions currently visible under the active filters */
  transactions: Transaction[]
  onClearSelection: () => void
}

/** Floating action bar shown while rows are selected. New bulk actions slot in
 * as additional buttons; each should clear the selection when it completes.
 * Every mutation records to the action log (main process), so undo/redo and the
 * Activity page pick them up automatically. */
export function TransactionsBulkActions({
  transactions,
  onClearSelection
}: TransactionsBulkActionsProps) {
  const queryClient = useQueryClient()
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const transactionIds = transactions.map((transaction) => transaction.id)
  // toggle direction: if every selected row is already a transfer, the action unmarks
  const allTransfers = transactions.length > 0 && transactions.every((t) => t.isTransfer)

  const setCategory = useMutation({
    mutationFn: (categoryId: number | null) =>
      window.api.transactions.setCategories({
        changes: transactions.map((t) => ({ transactionId: t.id, categoryId }))
      }),
    onSuccess: () => {
      setCategoryOpen(false)
      onClearSelection()
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  const setTransfer = useMutation({
    mutationFn: () =>
      window.api.transactions.setTransfer({ transactionIds, isTransfer: !allTransfers }),
    onSuccess: () => onClearSelection(),
    onSettled: () => queryClient.invalidateQueries()
  })

  const deleteTransactions = useMutation({
    mutationFn: () => window.api.transactions.bulkDelete({ transactionIds }),
    onSuccess: (deletedIds) => {
      if (deletedIds.length > 0) {
        toast(`${plural(deletedIds.length, 'transaction')} deleted`, {
          action: {
            label: 'Undo',
            onClick: () => {
              window.api.actionLog
                .undo()
                .then(() => queryClient.invalidateQueries())
                .catch(() => toast.error("Couldn't undo the delete"))
            }
          }
        })
      }
      setConfirmDelete(false)
      onClearSelection()
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  // bare-letter shortcuts for the bulk actions, active only while rows are selected;
  // skipped while typing so search/command inputs don't trigger them
  useEffect(() => {
    if (transactions.length === 0) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (event.key !== 'd' && event.key !== 'c' && event.key !== 't') return
      // the popover focuses its search input before this key's default text
      // insertion runs, so without this the shortcut letter gets typed into it
      event.preventDefault()
      if (event.key === 'd') setConfirmDelete(true)
      if (event.key === 'c') setCategoryOpen(true)
      if (event.key === 't') setTransfer.mutate()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions.length, allTransfers])

  if (transactions.length === 0) return null

  return (
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border bg-background p-1.5 shadow-lg">
      <span className="px-2.5 text-sm whitespace-nowrap text-muted-foreground">
        {transactions.length} selected
      </span>
      <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="lg" className="text-sm" title="Set category (c)">
            Set category
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="center" side="top">
          <CategoryPicker
            disabled={setCategory.isPending}
            onSelect={(categoryId) => setCategory.mutate(categoryId)}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="lg"
        className="text-sm"
        title={allTransfers ? 'Unmark transfer (t)' : 'Mark as transfer (t)'}
        disabled={setTransfer.isPending}
        onClick={() => setTransfer.mutate()}
      >
        {allTransfers ? 'Unmark transfer' : 'Mark as transfer'}
      </Button>
      <Button
        variant="destructive"
        size="lg"
        className="text-sm"
        title="Delete (d)"
        onClick={() => setConfirmDelete(true)}
      >
        Delete
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Clear selection"
        onClick={onClearSelection}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete{' '}
              {transactions.length === 1
                ? 'this transaction'
                : `${transactions.length} transactions`}
              ?
            </DialogTitle>
            <DialogDescription>
              They are removed from shmoney and stay deleted on future syncs. You can undo this with
              Ctrl+Z.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTransactions.isPending}
              onClick={() => deleteTransactions.mutate()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
