import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
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
import { useAutoCategorize, useLlmReady } from '@/lib/llm'
import { plural } from '@/lib/utils'

interface TransactionsBulkActionsProps {
  /** The selected transactions currently visible under the active filters */
  transactions: Transaction[]
  onClearSelection: () => void
}

/** Floating action bar shown while rows are selected. New bulk actions slot in
 * as additional buttons; the selection stays put after an action completes (only
 * the explicit clear button empties it), so several actions can be chained on the
 * same rows. Every mutation records to the action log (main process), so undo/redo
 * and the Activity page pick them up automatically. */
export function TransactionsBulkActions({
  transactions,
  onClearSelection
}: TransactionsBulkActionsProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const llmReady = useLlmReady()
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const transactionIds = transactions.map((transaction) => transaction.id)
  // toggle direction: if every selected row is already a transfer, the action unmarks
  const allTransfers = transactions.length > 0 && transactions.every((t) => t.isTransfer)

  const autoCategorize = useAutoCategorize({ transactionIds })

  const setCategory = useMutation({
    mutationFn: (categoryId: number | null) =>
      window.api.transactions.setCategories({
        changes: transactions.map((t) => ({ transactionId: t.id, categoryId }))
      }),
    onSuccess: () => setCategoryOpen(false),
    onSettled: () => queryClient.invalidateQueries()
  })

  const setTransfer = useMutation({
    mutationFn: () =>
      window.api.transactions.setTransfer({ transactionIds, isTransfer: !allTransfers }),
    onSettled: () => queryClient.invalidateQueries()
  })

  const deleteTransactions = useMutation({
    mutationFn: () => window.api.transactions.bulkDelete({ transactionIds }),
    onSuccess: (deletedIds) => {
      if (deletedIds.length > 0) {
        toast(`${plural(deletedIds.length, 'transaction')} deleted`, {
          action: { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
        })
      }
      setConfirmDelete(false)
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  // all controls are disabled while auto-categorize is running
  const busy = autoCategorize.isRunning

  // bare-letter shortcuts for the bulk actions, active only while rows are selected;
  // skipped while typing so search/command inputs don't trigger them
  useEffect(() => {
    if (transactions.length === 0) return
    function onKeyDown(event: KeyboardEvent) {
      if (busy || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (!['d', 'c', 't', 'a'].includes(event.key)) return
      // the popover focuses its search input before this key's default text
      // insertion runs, so without this the shortcut letter gets typed into it
      event.preventDefault()
      if (event.key === 'd') setConfirmDelete(true)
      if (event.key === 'c') setCategoryOpen(true)
      if (event.key === 't') setTransfer.mutate()
      if (event.key === 'a' && llmReady && !autoCategorize.anyRunning) autoCategorize.start()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions.length, allTransfers, llmReady, busy, autoCategorize.anyRunning])

  if (transactions.length === 0) return null

  return (
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col gap-1.5 rounded-xl border bg-background p-1.5 shadow-lg">
      <div className="flex items-center gap-1.5">
        <span className="px-2.5 text-sm whitespace-nowrap text-muted-foreground">
          {transactions.length} selected
        </span>
        <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="lg"
              className="text-sm"
              title="Set category (c)"
              disabled={busy}
            >
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
          disabled={setTransfer.isPending || busy}
          onClick={() => setTransfer.mutate()}
        >
          {allTransfers ? 'Unmark transfer' : 'Mark as transfer'}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="text-sm"
          disabled={!llmReady || busy || autoCategorize.anyRunning}
          title={llmReady ? 'Auto-categorize (a)' : 'Download a model in Settings to use this'}
          onClick={() => autoCategorize.start()}
        >
          Auto-categorize
        </Button>
        <Button
          variant="destructive"
          size="lg"
          className="text-sm"
          title="Delete (d)"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Clear selection"
          disabled={busy}
          onClick={onClearSelection}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>

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
