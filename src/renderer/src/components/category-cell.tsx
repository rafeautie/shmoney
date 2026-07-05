import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Transaction } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CategoryPicker } from '@/components/category-picker'

export function CategoryCell({ transaction }: { transaction: Transaction }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  // the main-process handler records the change to the action log for undo
  const setCategory = useMutation({
    mutationFn: (categoryId: number | null) =>
      window.api.transactions.setCategories({
        changes: [{ transactionId: transaction.id, categoryId }]
      }),
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
        <CategoryPicker
          selectedCategoryId={transaction.categoryId}
          disabled={setCategory.isPending}
          onSelect={(categoryId) => setCategory.mutate(categoryId)}
        />
      </PopoverContent>
    </Popover>
  )
}
