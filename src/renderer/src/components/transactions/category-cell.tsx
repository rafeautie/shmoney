import { memo, useState } from 'react'
import type { Transaction } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { CategoryPicker } from './category-picker'
import { CellPopover } from './cell-popover'
import { useTransactionEditsContext } from './use-transaction-edits'

export const CategoryCell = memo(function CategoryCell({
  transaction
}: {
  transaction: Transaction
}) {
  const { setCategory } = useTransactionEditsContext()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

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
    <CellPopover
      open={open}
      onOpenChange={setOpen}
      trigger={{
        variant: 'cell',
        size: 'sm',
        className: cn('-ml-2', !transaction.categoryName && 'text-muted-foreground'),
        onClick: (event) => event.stopPropagation()
      }}
      label={transaction.categoryName ?? 'Uncategorized'}
      contentClassName="w-56 p-0"
    >
      <CategoryPicker
        selectedCategoryId={transaction.categoryId}
        disabled={pending}
        onSelect={(categoryId) => {
          setPending(true)
          setCategory(transaction.id, categoryId)
            .then(
              () => setOpen(false),
              () => undefined
            )
            .finally(() => setPending(false))
        }}
      />
    </CellPopover>
  )
})
