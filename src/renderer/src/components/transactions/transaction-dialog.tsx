import { useState } from 'react'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import type { Transaction } from '@shared/ipc'
import { cn, currencySymbol, parseSignedAmount } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CategoryPicker } from './category-picker'
import { useTransactionEditsContext } from './use-transaction-edits'

type UpdateInput = Parameters<typeof window.api.transactions.update>[0]

/**
 * Edits every field of one transaction that can change after it's made: date,
 * description, amount and category. A row synced from the bank keeps the
 * bank's date, description and amount, so only its category is open. The
 * form lives in DialogContent, which unmounts on close, so each open starts
 * from the transaction's current values.
 */
export function TransactionDialog({
  open,
  onOpenChange,
  transaction
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100">
        <TransactionForm transaction={transaction} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** a stored date as its local calendar day */
function dayOf(epochSeconds: number): string {
  return format(new Date(epochSeconds * 1000), 'yyyy-MM-dd')
}

/** 'YYYY-MM-DD' as a local day; `new Date(string)` would read it as UTC. */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function TransactionForm({
  transaction,
  onDone
}: {
  transaction: Transaction
  onDone: () => void
}) {
  const { update } = useTransactionEditsContext()
  const locked = transaction.syncOwned
  const initialDay = dayOf(transaction.date)
  const [day, setDay] = useState(initialDay)
  const [description, setDescription] = useState(transaction.description)
  const [amount, setAmount] = useState(String(transaction.amount / 1000))
  const [categoryId, setCategoryId] = useState<number | null>(transaction.categoryId)
  const [categoryName, setCategoryName] = useState<string | null>(transaction.categoryName)
  const [dateOpen, setDateOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const parsedAmount = parseSignedAmount(amount)
  const canSubmit = description.trim() !== '' && parsedAmount !== null && !pending

  const save = (): void => {
    if (!canSubmit || parsedAmount === null) return
    // only what changed: each changed field is its own undoable change
    const input: UpdateInput = { id: transaction.id }
    if (!locked) {
      if (day !== initialDay) input.date = day
      if (description.trim() !== transaction.description) input.description = description.trim()
      if (parsedAmount !== transaction.amount) input.amount = parsedAmount
    }
    if (categoryId !== transaction.categoryId) input.categoryId = categoryId
    if (Object.keys(input).length === 1) return onDone()
    setPending(true)
    // a failure is toasted; the dialog stays open with the edits to retry
    update(input).then(onDone, () => setPending(false))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit Transaction</DialogTitle>
        <DialogDescription>
          {locked
            ? `Synced from your bank into ${transaction.accountName}, so only the category can change.`
            : `In ${transaction.accountName}. Money out is negative.`}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="transaction-description">Description</Label>
          <Input
            id="transaction-description"
            autoFocus={!locked}
            disabled={locked}
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Date</Label>
            {/* modal, like every popover in a dialog: the popup portals outside the
                DialogContent and the dialog's scroll lock would otherwise swallow it */}
            <Popover modal open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger
                disabled={locked}
                render={<Button variant="field" className="w-full justify-between" />}
              >
                {format(parseDay(day), 'MMM d, yyyy')}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={parseDay(day)}
                  defaultMonth={parseDay(day)}
                  onSelect={(next) => {
                    if (next) setDay(format(next, 'yyyy-MM-dd'))
                    setDateOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transaction-amount">Amount</Label>
            <NumberInput
              id="transaction-amount"
              // no min: amounts are signed, money out is negative
              prefix={currencySymbol(transaction.currency)}
              disabled={locked}
              value={amount}
              onValueChange={setAmount}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Popover modal open={categoryOpen} onOpenChange={setCategoryOpen}>
            <PopoverTrigger
              autoFocus={locked}
              render={<Button variant="field" className="w-full justify-between" />}
            >
              <span className={cn(!categoryName && 'text-muted-foreground')}>
                {categoryName ?? 'Uncategorized'}
              </span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent className="w-88 p-0" align="start">
              <CategoryPicker
                selectedCategoryId={categoryId}
                onSelect={(id, name) => {
                  setCategoryId(id)
                  setCategoryName(name)
                  setCategoryOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}
