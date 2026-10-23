import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { Transaction } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toastUndoable } from '@/lib/undo-toast'
import { invalidateTransactionData } from '@/lib/invalidate'
import { isDialogOpen, isTypingTarget, plural } from '@/lib/utils'
import { CategoryPicker } from './category-picker'
import {
  categorizeRunLabel,
  useAutoCategorize,
  useCategorizeRun,
  useLlmReady,
  useLlmSupported
} from '@/lib/llm'

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
  const llmReady = useLlmReady()
  const supported = useLlmSupported()
  const [categoryOpen, setCategoryOpen] = useState(false)

  const transactionIds = transactions.map((transaction) => transaction.id)

  const autoCategorize = useAutoCategorize({ transactionIds })
  const run = useCategorizeRun()

  const setCategory = useMutation({
    mutationFn: (categoryId: number | null) =>
      window.api.transactions.setCategories({
        changes: transactions.map((t) => ({ transactionId: t.id, categoryId }))
      }),
    onSuccess: () => setCategoryOpen(false),
    onSettled: () => invalidateTransactionData(queryClient)
  })

  const deleteTransactions = useMutation({
    mutationFn: () => window.api.transactions.bulkDelete({ transactionIds }),
    // no confirmation: like every other undoable delete, the toast's Undo
    // brings the rows back
    onSuccess: ({ deletedIds, actionId }) => {
      // the rows are gone; an undo shouldn't bring them back still selected
      onClearSelection()
      if (actionId !== null)
        toastUndoable(`Deleted ${plural(deletedIds.length, 'transaction')}`, actionId, queryClient)
    },
    onSettled: () => invalidateTransactionData(queryClient)
  })

  // all controls are disabled while auto-categorize is running
  const busy = autoCategorize.isRunning

  // bare-letter shortcuts for the bulk actions, active only while rows are selected;
  // skipped while typing so search/command inputs don't trigger them
  useEffect(() => {
    if (transactions.length === 0) return
    function onKeyDown(event: KeyboardEvent) {
      if (busy || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (!['d', 'c', 'a'].includes(event.key)) return
      // a letter typed while a dialog is up (e.g. a confirm or the import
      // dialog with focus on a button) must not trigger actions underneath it
      if (isDialogOpen()) return
      // the popover focuses its search input before this key's default text
      // insertion runs, so without this the shortcut letter gets typed into it
      event.preventDefault()
      if (event.key === 'd') deleteTransactions.mutate()
      if (event.key === 'c') setCategoryOpen(true)
      if (event.key === 'a' && llmReady && !autoCategorize.anyRunning) autoCategorize.start()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions.length, llmReady, busy, autoCategorize.anyRunning])

  if (transactions.length === 0) return null

  return (
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col gap-1.5 rounded-xl border bg-popover p-1.5 shadow-lg">
      <div className="flex items-center gap-1.5">
        <span className="px-2.5 text-sm whitespace-nowrap text-muted-foreground">
          {transactions.length} selected
        </span>
        <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="lg"
                className="text-sm"
                title="Set category (c)"
                disabled={busy}
              />
            }
          >
            Set Category
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
          className="text-sm tabular-nums"
          disabled={!llmReady || busy || autoCategorize.anyRunning}
          title={
            llmReady
              ? 'Auto-Categorize (a)'
              : supported
                ? 'Download a model in Settings to use this'
                : "Your hardware can't run the local model"
          }
          onClick={() => autoCategorize.start()}
        >
          {busy ? categorizeRunLabel(run) : 'Auto-Categorize'}
        </Button>
        {busy && (
          <Button
            variant="ghost"
            size="lg"
            className="text-sm"
            disabled={run.canceling}
            onClick={run.cancel}
          >
            Cancel
          </Button>
        )}
        <Button
          variant="destructive"
          size="lg"
          className="text-sm"
          title="Delete (d)"
          disabled={busy || deleteTransactions.isPending}
          onClick={() => deleteTransactions.mutate()}
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
    </div>
  )
}
