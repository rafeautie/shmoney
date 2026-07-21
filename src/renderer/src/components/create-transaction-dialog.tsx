import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Calendar03Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { ipcErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { CategoryPicker } from '@/components/category-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Direction = 'expense' | 'income'

/** Currency symbol for the account's ISO code, falling back to the code itself. */
function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

/**
 * Header action on the account detail page: a button that opens a form to add a
 * transaction by hand. Amount is entered as a positive magnitude with an
 * expense/income toggle that decides its sign; the main process stores it at
 * local noon of the chosen day and records the insert to the action log for undo.
 */
export function CreateTransactionDialog({
  accountId,
  currency
}: {
  accountId: number
  currency: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const [direction, setDirection] = useState<Direction>('expense')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState<Date>(() => new Date())
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categoryOpen, setCategoryOpen] = useState(false)

  // a stale entry must never carry over into the next open
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wholesale reset on reopen is the point; the extra render on a closed->open transition is harmless
    setDirection('expense')
    setAmount('')
    setDescription('')
    setDate(new Date())
    setCategoryId(null)
  }, [open])

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
  const ready = amountValid && description.trim() !== ''

  const create = useMutation({
    mutationFn: () => {
      const milliunits = Math.round(magnitude * 1000)
      return window.api.transactions.create({
        accountId,
        amount: direction === 'expense' ? -milliunits : milliunits,
        description: description.trim(),
        date: format(date, 'yyyy-MM-dd'),
        categoryId
      })
    },
    onSuccess: () => {
      toast('Transaction created')
      setOpen(false)
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="shrink-0" />}>
        <HugeiconsIcon icon={Add01Icon} size={16} />
        Create transaction
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create transaction</DialogTitle>
          <DialogDescription>Add a transaction to this account by hand.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <TabsList className="w-full">
              <TabsTrigger value="expense" className="flex-1">
                Expense
              </TabsTrigger>
              <TabsTrigger value="income" className="flex-1">
                Income
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-1.5">
            <Label htmlFor="create-txn-amount">Amount</Label>
            <NumberInput
              id="create-txn-amount"
              value={amount}
              onValueChange={setAmount}
              step={1}
              min={0}
              prefix={currencySymbol(currency)}
              placeholder="0.00"
              aria-invalid={amount.trim() !== '' && !amountValid}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="create-txn-description">Description</Label>
            <Input
              id="create-txn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Coffee"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger
                  render={<Button variant="outline" className="justify-start font-normal" />}
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
                    onSelect={(next) => next && setDate(next)}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger
                  render={<Button variant="outline" className="justify-between font-normal" />}
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
          {create.isError && (
            <p className="mr-auto self-center text-sm text-destructive">
              {ipcErrorMessage(create.error)}
            </p>
          )}
          <Button onClick={() => create.mutate()} disabled={!ready || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create transaction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
