import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { Category } from '@shared/ipc'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, parseDollars } from '@/lib/utils'

export function AddEnvelopeDialog({
  open,
  onOpenChange,
  month,
  budgetedIds
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** viewed month; the new envelope starts here */
  month: string
  /** categories that already have an envelope */
  budgetedIds: number[]
}) {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<Category | null>(null)
  const [amount, setAmount] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })

  const create = useMutation({
    mutationFn: (input: { categoryId: number; month: string; amount: number }) =>
      window.api.budgets.setFill(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-summary'] })
      queryClient.invalidateQueries({ queryKey: ['actionLog'] })
      onOpenChange(false)
    }
  })

  const budgeted = new Set(budgetedIds)
  const data = categoriesQuery.data
  // system categories (Income, Transfers) live in data.system and are never offered
  const groups = (data?.groups ?? [])
    .map((group) => ({ ...group, categories: group.categories.filter((c) => !budgeted.has(c.id)) }))
    .filter((group) => group.categories.length > 0)
  const ungrouped = (data?.ungrouped ?? []).filter((c) => !budgeted.has(c.id))

  const parsedAmount = parseDollars(amount)
  const canSubmit = category !== null && parsedAmount !== null && !create.isPending

  function reset() {
    setCategory(null)
    setAmount('')
  }

  function pick(c: Category) {
    setCategory(c)
    setPickerOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>Add envelope</DialogTitle>
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
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between border-input bg-input/20 font-normal"
                >
                  <span className={cn(!category && 'text-muted-foreground')}>
                    {category?.name ?? 'Pick a category...'}
                  </span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={14}
                    className="text-muted-foreground"
                  />
                </Button>
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
                          >
                            <span className="truncate">{c.name}</span>
                            {category?.id === c.id && (
                              <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                    {ungrouped.length > 0 && (
                      <CommandGroup heading="Other">
                        {ungrouped.map((c) => (
                          <CommandItem key={c.id} value={c.name} onSelect={() => pick(c)}>
                            <span className="truncate">{c.name}</span>
                            {category?.id === c.id && (
                              <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="envelope-amount">Monthly fill</Label>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="envelope-amount"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit && category && parsedAmount !== null) {
                    create.mutate({ categoryId: category.id, month, amount: parsedAmount })
                  }
                }}
              />
            </InputGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (category && parsedAmount !== null) {
                create.mutate({ categoryId: category.id, month, amount: parsedAmount })
              }
            }}
          >
            {create.isPending ? 'Adding...' : 'Add envelope'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
