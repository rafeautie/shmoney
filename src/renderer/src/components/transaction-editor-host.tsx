import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Calendar03Icon, CornerDownLeftIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { currencySymbol, ipcErrorMessage } from '@/lib/utils'
import { useTransactionEditor, type TransactionEditorState } from '@/lib/transaction-editor'
import { AccountPicker } from '@/components/account-picker'
import { CategoryPicker } from '@/components/category-picker'
import { ConfirmDialog, KeyHint } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Direction = 'expense' | 'income'

/**
 * The one transaction editor: a root-hosted dialog covering both create and
 * edit, opened from anywhere via useTransactionEditor (button, N shortcut, row
 * click, E shortcut). Keyboard-first: amount takes focus, Enter saves, Ctrl+Enter
 * saves and starts the next entry (create mode), Escape closes. Amount is entered
 * as a positive magnitude with an expense/income toggle deciding its sign; the
 * main process anchors dates at local noon and records every write to the action
 * log for undo.
 */
export function TransactionEditorHost(): React.JSX.Element {
  const { state, openCreate, close } = useTransactionEditor()
  const pathname = useLocation({ select: (location) => location.pathname })

  // bare N opens create from any page, defaulting to the account being viewed;
  // skipped while typing or while any dialog is already up
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (document.querySelector('[data-slot="dialog-content"]')) return
      event.preventDefault()
      const accountMatch = /^\/accounts\/(\d+)$/.exec(pathname)
      openCreate(accountMatch ? { accountId: Number(accountMatch[1]) } : undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pathname, openCreate])

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
      {state !== null && (
        <TransactionEditorDialog
          // remount per target so form state can never leak between opens
          key={state.mode === 'edit' ? `edit-${state.transaction.id}` : 'create'}
          state={state}
          onClose={close}
        />
      )}
    </Dialog>
  )
}

function TransactionEditorDialog({
  state,
  onClose
}: {
  state: TransactionEditorState
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const amountRef = useRef<HTMLInputElement>(null)

  const editing = state.mode === 'edit' ? state.transaction : null
  // sync refreshes amount/description/date on its rows, so editing them would
  // be silently clobbered; only the category (user-owned) stays editable
  const locked = editing !== null && editing.syncOwned

  const [direction, setDirection] = useState<Direction>(
    editing !== null && editing.amount > 0 ? 'income' : 'expense'
  )
  const [accountId, setAccountId] = useState<number | null>(
    state.mode === 'create' ? (state.defaultAccountId ?? null) : null
  )
  const [amount, setAmount] = useState(editing ? String(Math.abs(editing.amount) / 1000) : '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [date, setDate] = useState<Date>(() =>
    editing?.date ? new Date(editing.date * 1000) : new Date()
  )
  const [categoryId, setCategoryId] = useState<number | null>(editing?.categoryId ?? null)
  const [dateOpen, setDateOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const accounts = accountsQuery.data ?? []
  // no explicit choice yet: default to the first account once the list loads
  const effectiveAccountId = accountId ?? accounts[0]?.id ?? null
  const currency = editing
    ? editing.currency
    : (accounts.find((a) => a.id === effectiveAccountId)?.currency ?? 'USD')

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  const categoryName =
    categoryId === null
      ? null
      : ([
          ...(categoriesQuery.data?.groups.flatMap((g) => g.categories) ?? []),
          ...(categoriesQuery.data?.ungrouped ?? []),
          ...(categoriesQuery.data?.system ?? [])
        ].find((c) => c.id === categoryId)?.name ?? null)

  const magnitude = Number(amount)
  // reject amounts that round to zero milliunits (e.g. 0.0004) before submit,
  // rather than letting the server bounce them with "Amount must not be zero"
  const amountValid =
    amount.trim() !== '' && Number.isFinite(magnitude) && Math.round(magnitude * 1000) > 0
  const ready = locked
    ? true
    : amountValid && description.trim() !== '' && (editing !== null || effectiveAccountId !== null)

  const save = useMutation({
    // keepOpen is only read in onSuccess (save & add another)
    mutationFn: (_variables: { keepOpen: boolean }) => {
      if (editing) {
        // locked rows only ever send the category — the server rejects the rest
        return window.api.transactions.update(
          locked
            ? { id: editing.id, categoryId }
            : {
                id: editing.id,
                amount:
                  direction === 'expense'
                    ? -Math.round(magnitude * 1000)
                    : Math.round(magnitude * 1000),
                description: description.trim(),
                date: format(date, 'yyyy-MM-dd'),
                categoryId
              }
        )
      }
      const milliunits = Math.round(magnitude * 1000)
      return window.api.transactions.create({
        accountId: effectiveAccountId!,
        amount: direction === 'expense' ? -milliunits : milliunits,
        description: description.trim(),
        date: format(date, 'yyyy-MM-dd'),
        categoryId
      })
    },
    onSuccess: (result, { keepOpen }) => {
      if (editing) {
        // 0 fields changed = nothing to say; close silently
        if (result > 0) toast('Transaction updated')
        onClose()
        return
      }
      toast('Transaction created')
      if (!keepOpen) {
        onClose()
        return
      }
      // rapid entry: date, account, and direction stick; the rest clears
      setAmount('')
      setDescription('')
      setCategoryId(null)
      amountRef.current?.focus()
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  const deleteTransaction = useMutation({
    mutationFn: () => window.api.transactions.bulkDelete({ transactionIds: [editing!.id] }),
    onSuccess: () => {
      setConfirmDelete(false)
      toast('Transaction deleted')
      onClose()
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  const submit = (keepOpen: boolean) => {
    if (ready && !save.isPending) save.mutate({ keepOpen })
  }

  return (
    <DialogContent className="sm:max-w-md" initialFocus={locked ? undefined : amountRef}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // an open picker swallows Escape (closing just itself); a second
            // Escape then reaches us and closes the dialog
            event.preventDefault()
            if (dateOpen || categoryOpen) {
              setDateOpen(false)
              setCategoryOpen(false)
            } else if (!save.isPending) {
              onClose()
            }
            return
          }
          if (
            state.mode === 'create' &&
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault()
            submit(true)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit transaction' : 'Create transaction'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes are recorded to Activity and can be undone.'
              : 'Add a transaction by hand.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {state.mode === 'create' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="txn-editor-account">Account</Label>
              <AccountPicker
                id="txn-editor-account"
                value={effectiveAccountId}
                onChange={setAccountId}
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label>Account</Label>
              <p className="text-sm text-muted-foreground">{editing!.accountName}</p>
            </div>
          )}

          {locked && (
            <p className="text-sm text-muted-foreground">
              Amount, description, and date come from your bank and refresh on sync. You can edit
              the category.
            </p>
          )}

          <Tabs
            value={direction}
            onValueChange={(v) => setDirection(v as Direction)}
            className={locked ? 'pointer-events-none opacity-50' : undefined}
          >
            <TabsList className="w-full">
              <TabsTrigger value="expense" className="flex-1" disabled={locked}>
                Expense
              </TabsTrigger>
              <TabsTrigger value="income" className="flex-1" disabled={locked}>
                Income
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-1.5">
            <Label htmlFor="txn-editor-amount">Amount</Label>
            <NumberInput
              ref={amountRef}
              id="txn-editor-amount"
              value={amount}
              onValueChange={setAmount}
              step={1}
              min={0}
              prefix={currencySymbol(currency)}
              placeholder="0.00"
              disabled={locked}
              aria-invalid={amount.trim() !== '' && !amountValid}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="txn-editor-description">Description</Label>
            <Input
              id="txn-editor-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Coffee"
              disabled={locked}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-start font-normal"
                      disabled={locked}
                    />
                  }
                >
                  <HugeiconsIcon
                    icon={Calendar03Icon}
                    size={16}
                    className="text-muted-foreground"
                  />
                  {format(date, 'MMM d, yyyy')}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    defaultMonth={date}
                    onSelect={(next) => {
                      if (next) setDate(next)
                      setDateOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-between font-normal"
                    />
                  }
                >
                  <span className={categoryName ? undefined : 'text-muted-foreground'}>
                    {categoryName ?? 'Uncategorized'}
                  </span>
                  <HugeiconsIcon icon={UnfoldMoreIcon} size={14} className="shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <CategoryPicker
                    selectedCategoryId={categoryId}
                    onSelect={(id) => {
                      setCategoryId(id)
                      setCategoryOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <DialogFooter>
          {editing && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          {save.isError && (
            <p className="mr-auto self-center text-sm text-destructive">
              {ipcErrorMessage(save.error)}
            </p>
          )}
          {state.mode === 'create' && (
            <Button
              type="button"
              variant="outline"
              disabled={!ready || save.isPending}
              onClick={() => submit(true)}
            >
              Save & add another
              <KeyHint>Ctrl</KeyHint>
              <KeyHint>
                <HugeiconsIcon icon={CornerDownLeftIcon} className="size-3" strokeWidth={2} />
              </KeyHint>
            </Button>
          )}
          <Button type="submit" disabled={!ready || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
            <KeyHint>
              <HugeiconsIcon icon={CornerDownLeftIcon} className="size-3" strokeWidth={2} />
            </KeyHint>
          </Button>
        </DialogFooter>
      </form>

      {editing && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this transaction?"
          description="It is removed from shmoney and stays deleted on future syncs. You can undo this with Ctrl+Z."
          pending={deleteTransaction.isPending}
          onConfirm={() => deleteTransaction.mutate()}
        />
      )}
    </DialogContent>
  )
}
