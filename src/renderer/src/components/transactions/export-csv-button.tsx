import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FileExportIcon } from '@hugeicons/core-free-icons'
import type { TransactionSortBy } from '@shared/ipc'
import type { ResolvedTransactionFilters } from '@shared/transaction-filters'
import { Button } from '@/components/ui/button'
import { isDemo } from '@/lib/platform'
import { ipcErrorMessage } from '@/lib/utils'

interface ExportCsvButtonProps {
  /** exactly what the table below is showing */
  filters: ResolvedTransactionFilters
  sortBy: TransactionSortBy
  sortDir: 'asc' | 'desc'
  /** account-scoped views; omitted = every account */
  accountId?: number
}

export function ExportCsvButton({ filters, sortBy, sortDir, accountId }: ExportCsvButtonProps) {
  const exportCsv = useMutation({
    mutationFn: () => window.api.transactions.exportCsv({ filters, accountId, sortBy, sortDir }),
    onSuccess: (path) => {
      // null: the save dialog was cancelled. The demo's browser download reports itself
      if (!path || isDemo) return
      toast('Transactions exported', {
        description: path,
        action: {
          label: 'Show in folder',
          onClick: () => void window.api.storage.showInFolder(path)
        }
      })
    },
    onError: (error) => toast.error(ipcErrorMessage(error))
  })

  return (
    <Button
      variant="field"
      size="lg"
      disabled={exportCsv.isPending}
      onClick={() => exportCsv.mutate()}
    >
      <HugeiconsIcon icon={FileExportIcon} size={14} className="text-muted-foreground" />
      Export CSV
    </Button>
  )
}
