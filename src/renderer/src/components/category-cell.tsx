import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Transaction } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CategoryPicker } from '@/components/category-picker'
import { undoHistory } from '@/lib/undo'

export function CategoryCell({ transaction }: { transaction: Transaction }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const setCategory = useMutation({
    mutationFn: async (categoryId: number | null) => {
      const previous = transaction.categoryId
      await window.api.transactions.setCategory({ transactionId: transaction.id, categoryId })
      return { previous, next: categoryId }
    },
    onSuccess: ({ previous, next }) => {
      if (previous !== next) {
        const { id } = transaction
        undoHistory.push({
          label: 'Set category',
          undo: () =>
            window.api.transactions.setCategory({ transactionId: id, categoryId: previous }),
          redo: () => window.api.transactions.setCategory({ transactionId: id, categoryId: next })
        })
      }
      setOpen(false)
    },
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
