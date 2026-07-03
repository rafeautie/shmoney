import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import type { Transaction } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

export function CategoryCell({ transaction }: { transaction: Transaction }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list(),
    enabled: open
  })

  const setCategory = useMutation({
    mutationFn: (categoryId: number | null) =>
      window.api.transactions.setCategory({ transactionId: transaction.id, categoryId }),
    onSuccess: () => setOpen(false),
    onSettled: () => queryClient.invalidateQueries()
  })

  if (transaction.pending) {
    return (
      <span
        className="text-muted-foreground"
        title="Pending transactions can be categorized once they post"
      >
        —
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('-ml-2 font-normal', !transaction.categoryName && 'text-muted-foreground')}
          onClick={(event) => event.stopPropagation()}
        >
          {transaction.categoryName ?? 'Uncategorized'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search categories..." />
          <CommandList>
            <CommandEmpty>No categories found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Uncategorized"
                disabled={setCategory.isPending}
                onSelect={() => setCategory.mutate(null)}
              >
                <span className="text-muted-foreground">Uncategorized</span>
                {transaction.categoryId === null && (
                  <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                )}
              </CommandItem>
            </CommandGroup>
            {categoriesQuery.data?.groups.map((group) => (
              <CommandGroup key={group.id} heading={group.name}>
                {group.categories.map((category) => (
                  <CommandItem
                    key={category.id}
                    value={`${group.name} ${category.name}`}
                    disabled={setCategory.isPending}
                    onSelect={() => setCategory.mutate(category.id)}
                  >
                    {category.name}
                    {transaction.categoryId === category.id && (
                      <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {categoriesQuery.data && categoriesQuery.data.ungrouped.length > 0 && (
              <CommandGroup heading="Ungrouped">
                {categoriesQuery.data.ungrouped.map((category) => (
                  <CommandItem
                    key={category.id}
                    value={`Ungrouped ${category.name}`}
                    disabled={setCategory.isPending}
                    onSelect={() => setCategory.mutate(category.id)}
                  >
                    {category.name}
                    {transaction.categoryId === category.id && (
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
  )
}
