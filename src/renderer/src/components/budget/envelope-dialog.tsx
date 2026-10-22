import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import type { EnvelopeSummary } from '@shared/budgets'
import type { Category } from '@shared/ipc'
import { useUpdateEnvelope } from '@/components/budget/use-envelopes'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, currencySymbol, parseDollars } from '@/lib/utils'
import { useAccountCurrency } from '@/lib/currency'

interface EnvelopeDialogProps {
  /** viewed month; a new envelope starts here, an edited fill applies from here on */
  month: string
  /** categories that already have an envelope */
  budgetedIds: number[]
}

/**
 * Adds an envelope, or edits both of `envelope`'s fields when one is given. The
 * form lives in DialogContent, which unmounts on close, so each open starts
 * from fresh state: blank for a new envelope, the current values for an edit.
 */
export function EnvelopeDialog({
  open,
  onOpenChange,
  envelope,
  ...formProps
}: EnvelopeDialogProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  envelope?: EnvelopeSummary
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100">
        <EnvelopeForm {...formProps} envelope={envelope} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function EnvelopeForm({
  month,
  budgetedIds,
  envelope,
  onDone
}: EnvelopeDialogProps & { envelope?: EnvelopeSummary; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<Pick<Category, 'id' | 'name'> | null>(
    envelope ? { id: envelope.categoryId, name: envelope.categoryName } : null
  )
  const [amount, setAmount] = useState(envelope ? (envelope.fill / 1000).toString() : '')
  const [pickerOpen, setPickerOpen] = useState(false)

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  // envelopes span every account, so the fill is labelled with the dominant one
  const currency = useAccountCurrency()

  const create = useMutation({
    mutationFn: (input: { categoryId: number; month: string; amount: number }) =>
      window.api.budgets.setFill(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-summary'] })
      queryClient.invalidateQueries({ queryKey: ['actionLog'] })
      onDone()
    }
  })
  const update = useUpdateEnvelope()
  const pending = create.isPending || update.isPending

  // an edit may keep its own category, so only the others count as taken
  const budgeted = new Set(budgetedIds.filter((id) => id !== envelope?.categoryId))
  const data = categoriesQuery.data
  // system categories (Income, Transfers) live in data.system and are never offered
  const groups = (data?.groups ?? [])
    .map((group) => ({ ...group, categories: group.categories.filter((c) => !budgeted.has(c.id)) }))
    .filter((group) => group.categories.length > 0)
  const ungrouped = (data?.ungrouped ?? []).filter((c) => !budgeted.has(c.id))

  const parsedAmount = parseDollars(amount)
  // a new envelope needs a positive fill: parseDollars('') is 0 (not null), so
  // an untouched field would otherwise create a $0 one. An edit may set 0 to
  // pause an envelope without losing its history, but not leave the field empty
  const canSubmit =
    category !== null &&
    parsedAmount !== null &&
    (envelope ? amount.trim() !== '' : parsedAmount > 0) &&
    !pending

  function pick(c: Category) {
    setCategory(c)
    setPickerOpen(false)
  }

  function save() {
    if (!canSubmit || category === null || parsedAmount === null) return
    if (!envelope) {
      create.mutate({ categoryId: category.id, month, amount: parsedAmount })
      return
    }
    // only what changed, so an untouched fill isn't re-anchored at this month
    const moving = category.id !== envelope.categoryId
    const refilling = parsedAmount !== envelope.fill
    if (!moving && !refilling) return onDone()
    update.mutate(
      {
        categoryId: envelope.categoryId,
        month,
        newCategoryId: moving ? category.id : undefined,
        amount: refilling ? parsedAmount : undefined
      },
      { onSuccess: onDone }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{envelope ? 'Edit envelope' : 'Add envelope'}</DialogTitle>
        <DialogDescription>
          Pick a category and how much to set aside for it each month. Whatever you don't spend
          stays in the envelope.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Category</Label>
          {/* modal: the popover portals outside the DialogContent, and the modal
              dialog's scroll lock would otherwise swallow wheel events over the list */}
          <Popover modal open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger render={<Button variant="field" className="w-full justify-between" />}>
              <span className={cn(!category && 'text-muted-foreground')}>
                {category?.name ?? 'Pick a category...'}
              </span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent className="w-88 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search categories..." />
                <CommandList>
                  <CommandEmpty>No categories left to budget.</CommandEmpty>
                  {groups.map((group) => (
                    <CommandGroup key={group.id} heading={group.name}>
                      {group.categories.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${group.name} ${c.name}`}
                          onSelect={() => pick(c)}
                          checked={category?.id === c.id}
                        >
                          <span className="truncate">{c.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  {ungrouped.length > 0 && (
                    <CommandGroup heading="Other">
                      {ungrouped.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => pick(c)}
                          checked={category?.id === c.id}
                        >
                          <span className="truncate">{c.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {envelope && category && category.id !== envelope.categoryId && (
            <p className="text-xs text-muted-foreground">
              The envelope moves with its history; spending is counted from {category.name} instead.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="envelope-amount">Monthly fill</Label>
          <NumberInput
            id="envelope-amount"
            autoFocus={envelope !== undefined}
            placeholder="0.00"
            prefix={currencySymbol(currency)}
            min={0}
            value={amount}
            onValueChange={setAmount}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          {envelope && (
            <p className="text-xs text-muted-foreground">
              A new amount applies from this month on; earlier months keep theirs.
            </p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={save}>
          {envelope ? (pending ? 'Saving...' : 'Save') : pending ? 'Adding...' : 'Add envelope'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** The add-envelope dialog and the button that opens it. `children` overrides the
 * label for entry points that phrase it differently (e.g. an empty state). */
export function AddEnvelopeButton({
  children = 'Add envelope',
  ...dialogProps
}: EnvelopeDialogProps & { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>{children}</Button>
      <EnvelopeDialog {...dialogProps} open={open} onOpenChange={setOpen} />
    </>
  )
}
