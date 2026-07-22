import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons'
import type { Transaction } from '@shared/ipc'
import { cn, ipcErrorMessage, parseSignedAmount } from '@/lib/utils'
import { AccountPicker } from '@/components/account-picker'
import { Amount } from '@/components/amount'
import { CategoryPicker } from '@/components/category-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TableCell, TableRow } from '@/components/ui/table'

const SYNCED_TITLE = 'Synced from your bank'

// every cell edit goes through transactions:update, which records an undoable
// action-log entry per changed field; the cell updating is the feedback (no toast)
function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof window.api.transactions.update>[0]) =>
      window.api.transactions.update(input),
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries()
  })
}

/** Description cell: click to edit in place. Pending/synced rows are plain text. */
export function EditableTextCell({ transaction }: { transaction: Transaction }) {
  const [draft, setDraft] = useState<string | null>(null)
  const update = useUpdateTransaction()

  const display = (
    <div className="flex min-w-0 items-center gap-1.5" title={transaction.description}>
      {transaction.isTransfer && (
        <span title="Transfer" className="flex shrink-0">
          <HugeiconsIcon
            icon={ArrowDataTransferHorizontalIcon}
            size={14}
            className="text-muted-foreground"
          />
        </span>
      )}
      <span className="truncate">
        {transaction.description}
        {transaction.pending && <span className="text-muted-foreground"> (pending)</span>}
      </span>
    </div>
  )

  if (transaction.pending) return display
  if (transaction.syncOwned) return <div title={SYNCED_TITLE}>{display}</div>

  if (draft !== null) {
    const commit = () => {
      const trimmed = draft.trim()
      if (trimmed !== '' && trimmed !== transaction.description) {
        update.mutate({ id: transaction.id, description: trimmed })
      }
      setDraft(null)
    }
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 w-full min-w-0 justify-start font-normal"
      onClick={() => setDraft(transaction.description)}
    >
      {display}
    </Button>
  )
}

/** Amount cell: click to edit the literal signed decimal (negative = expense). */
export function EditableAmountCell({ transaction }: { transaction: Transaction }) {
  const [draft, setDraft] = useState<string | null>(null)
  const update = useUpdateTransaction()

  const display = (
    <Amount
      value={transaction.amount}
      currency={transaction.currency}
      colored={!transaction.isTransfer}
      className={cn(transaction.isTransfer && 'text-muted-foreground')}
    />
  )

  if (transaction.pending) return <div className="text-right">{display}</div>
  if (transaction.syncOwned) {
    return (
      <div className="text-right" title={SYNCED_TITLE}>
        {display}
      </div>
    )
  }

  if (draft !== null) {
    const commit = () => {
      const amount = parseSignedAmount(draft)
      if (amount !== null && amount !== transaction.amount) {
        update.mutate({ id: transaction.id, amount })
      }
      setDraft(null)
    }
    return (
      <Input
        autoFocus
        inputMode="decimal"
        className="text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    )
  }

  return (
    <div className="text-right">
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2 font-normal"
        onClick={() => setDraft(String(transaction.amount / 1000))}
      >
        {display}
      </Button>
    </div>
  )
}

/** Date cell: click for a calendar; picking a day commits immediately. */
export function EditableDateCell({ transaction }: { transaction: Transaction }) {
  const [open, setOpen] = useState(false)
  const update = useUpdateTransaction()

  const label = transaction.date ? format(new Date(transaction.date * 1000), 'MMM d, yyyy') : '—'

  if (transaction.pending) return <span>{label}</span>
  if (transaction.syncOwned) return <span title={SYNCED_TITLE}>{label}</span>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="-ml-2 font-normal whitespace-nowrap" />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={transaction.date ? new Date(transaction.date * 1000) : undefined}
          defaultMonth={transaction.date ? new Date(transaction.date * 1000) : undefined}
          onSelect={(next) => {
            if (next) update.mutate({ id: transaction.id, date: format(next, 'yyyy-MM-dd') })
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Pinned entry row at the top of a transactions table. Enter commits when
 * description and a signed amount are filled; date, account, and category are
 * kept for the next entry (rapid entry), the rest clears. Esc clears the drafts.
 */
export function TransactionCreateRow({
  showAccount,
  accountId
}: {
  /** render an account cell (multi-account views); otherwise `accountId` is fixed */
  showAccount?: boolean
  accountId?: number
}) {
  const queryClient = useQueryClient()
  const [date, setDate] = useState<Date>(() => new Date())
  const [dateOpen, setDateOpen] = useState(false)
  const [pickedAccountId, setPickedAccountId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const descriptionRef = useRef<HTMLInputElement>(null)

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list(),
    enabled: showAccount
  })
  const effectiveAccountId = accountId ?? pickedAccountId ?? accountsQuery.data?.[0]?.id ?? null

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

  const create = useMutation({
    mutationFn: () =>
      window.api.transactions.create({
        accountId: effectiveAccountId!,
        amount: parseSignedAmount(amount)!,
        description: description.trim(),
        date: format(date, 'yyyy-MM-dd'),
        categoryId
      }),
    onSuccess: () => {
      toast('Transaction created')
      setDescription('')
      setAmount('')
      setCategoryId(null)
      descriptionRef.current?.focus()
    },
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries()
  })

  const ready =
    description.trim() !== '' &&
    parseSignedAmount(amount) !== null &&
    effectiveAccountId !== null &&
    !create.isPending

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && ready) create.mutate()
    if (event.key === 'Escape') {
      setDescription('')
      setAmount('')
      setCategoryId(null)
    }
  }

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30" onKeyDown={onKeyDown}>
      {/* aligns with the selection checkbox column */}
      <TableCell />
      <TableCell>
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="sm" className="-ml-2 font-normal whitespace-nowrap" />
            }
          >
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
      </TableCell>
      {showAccount && (
        <TableCell>
          <AccountPicker value={effectiveAccountId} onChange={setPickedAccountId} />
        </TableCell>
      )}
      <TableCell className="w-full">
        <Input
          ref={descriptionRef}
          // the row mounts when the page's Create toggle turns it on; start typing
          autoFocus
          placeholder="Add transaction"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className={cn('-ml-2 font-normal', !categoryName && 'text-muted-foreground')}
              />
            }
          >
            {categoryName ?? 'Uncategorized'}
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
      </TableCell>
      <TableCell className="text-right">
        <Input
          inputMode="decimal"
          className="w-24 text-right"
          placeholder="-0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </TableCell>
    </TableRow>
  )
}
