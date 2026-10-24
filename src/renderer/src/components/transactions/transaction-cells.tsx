import { memo, useRef, useState, type ComponentProps } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDataTransferHorizontalIcon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon
} from '@hugeicons/core-free-icons'
import type { Transaction } from '@shared/ipc'
import { merchantOf } from '@shared/merchant'
import { cn, currencySymbol, ipcErrorMessage, parseSignedAmount } from '@/lib/utils'
import { invalidateTransactionData } from '@/lib/invalidate'
import { toastUndoable } from '@/lib/undo-toast'
import { ActionsMenuItem } from '@/components/actions-menu'
import { useAccountCurrency } from '@/lib/currency'
import { AccountPicker } from '@/components/accounts/account-picker'
import { Amount } from '@/components/amount'
import { CategoryPicker } from './category-picker'
import { TransactionDialog } from './transaction-dialog'
import { useRowExpanded } from '@/components/data-table-row-expanded'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TableCell, TableRow } from '@/components/ui/table'

function merchantInitial(description: string): string {
  return (merchantOf(description) ?? description).match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() ?? '?'
}

/** A small round mark leading the description: the merchant's initial, or arrows for a transfer */
function MerchantMark({ transaction }: { transaction: Transaction }) {
  return (
    <span
      aria-hidden={!transaction.isTransfer}
      title={transaction.isTransfer ? 'Transfer' : undefined}
      className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground"
    >
      {transaction.isTransfer ? (
        <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} className="size-3" />
      ) : (
        merchantInitial(transaction.description)
      )}
    </span>
  )
}

// The description, amount and date cells only show the row: every change goes
// through the Edit dialog in the row's actions menu (the category keeps its
// quick picker, for sorting many rows in a row).

/** Description cell, with the merchant mark, transfer counterpart and pending badge */
export const DescriptionCell = memo(function DescriptionCell({
  transaction
}: {
  transaction: Transaction
}) {
  const transferAccount = transaction.isTransfer ? transaction.transferAccountName : null
  return (
    <div className="flex min-w-0 items-center gap-2" title={transaction.description}>
      <MerchantMark transaction={transaction} />
      <span className="truncate">{transaction.description}</span>
      {transferAccount && (
        <span className="shrink-0 text-muted-foreground">
          {transaction.amount < 0 ? 'to' : 'from'} {transferAccount}
        </span>
      )}
      {transaction.pending && (
        <Badge variant="secondary" className="shrink-0">
          Pending
        </Badge>
      )}
    </div>
  )
})

/** Amount cell: the signed amount, transfers dimmed rather than colored */
export const AmountCell = memo(function AmountCell({ transaction }: { transaction: Transaction }) {
  return (
    <div className="text-right">
      <Amount
        value={transaction.amount}
        currency={transaction.currency}
        colored={!transaction.isTransfer}
        className={cn(transaction.isTransfer && 'text-muted-foreground')}
      />
    </div>
  )
})

export const DateCell = memo(function DateCell({ transaction }: { transaction: Transaction }) {
  return (
    <span className="whitespace-nowrap">
      {transaction.date ? format(new Date(transaction.date * 1000), 'MMM d, yyyy') : '—'}
    </span>
  )
})

/**
 * The row's actions menu: Edit, and Delete with an Undo toast (no confirmation,
 * like every undoable delete). Like CellPopover, it is a plain button
 * until first opened, so long tables don't carry a closed menu and dialog per
 * row. Pending rows have none: sync replaces them, so an edit would be lost.
 */
export const TransactionActionsCell = memo(function TransactionActionsCell({
  transaction
}: {
  transaction: Transaction
}) {
  const [mounted, setMounted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // the row stays highlighted while its menu or dialog is up
  useRowExpanded(menuOpen || editing)

  const triggerProps = {
    variant: 'ghost',
    size: 'icon-sm',
    'aria-label': 'Transaction Actions'
  } satisfies ComponentProps<typeof Button>
  const icon = <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />

  if (transaction.pending) return null
  if (!mounted) {
    return (
      <div className="text-right">
        <Button
          {...triggerProps}
          onClick={() => {
            setMounted(true)
            setMenuOpen(true)
          }}
        >
          {icon}
        </Button>
      </div>
    )
  }

  return (
    <div className="text-right">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger render={<Button {...triggerProps} />}>{icon}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          <ActionsMenuItem icon={PencilEdit01Icon} onClick={() => setEditing(true)}>
            Edit
          </ActionsMenuItem>
          <TransactionDeleteItem transaction={transaction} />
        </DropdownMenuContent>
      </DropdownMenu>
      <TransactionDialog open={editing} onOpenChange={setEditing} transaction={transaction} />
    </div>
  )
})

function TransactionDeleteItem({ transaction }: { transaction: Transaction }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => window.api.transactions.bulkDelete({ transactionIds: [transaction.id] }),
    onSuccess: ({ actionId }) => {
      if (actionId !== null)
        toastUndoable(`Deleted “${transaction.description}”`, actionId, queryClient)
    },
    onSettled: () => invalidateTransactionData(queryClient)
  })
  return (
    <ActionsMenuItem
      icon={Delete02Icon}
      destructive
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
    >
      Delete
    </ActionsMenuItem>
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
  // the row's amount is entered in whichever account it lands on
  const currency = useAccountCurrency(effectiveAccountId)

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
    onSettled: () => invalidateTransactionData(queryClient)
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
    <TableRow className="bg-tray hover:bg-tray" onKeyDown={onKeyDown}>
      {/* aligns with the selection checkbox column */}
      <TableCell />
      <TableCell>
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger render={<Button variant="field" className="whitespace-nowrap" />}>
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
                variant="field"
                className={cn('whitespace-nowrap', !categoryName && 'text-muted-foreground')}
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
        <NumberInput
          className="w-28"
          prefix={currencySymbol(currency)}
          inputClassName="text-right"
          placeholder="-0.00"
          value={amount}
          onValueChange={setAmount}
        />
      </TableCell>
    </TableRow>
  )
}
