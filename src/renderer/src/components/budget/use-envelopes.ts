import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BudgetUpdateInput, EnvelopeSummary } from '@shared/budgets'
import { ipcErrorMessage } from '@/lib/utils'
import { toastUndoable } from '@/lib/undo-toast'

function useInvalidateBudget(): () => void {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['budget-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  }
}

export function useUpdateEnvelope(): UseMutationResult<unknown, Error, BudgetUpdateInput> {
  const invalidate = useInvalidateBudget()
  return useMutation({
    mutationFn: (input: BudgetUpdateInput) => window.api.budgets.update(input),
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}

export function useRemoveEnvelope(): UseMutationResult<void, Error, EnvelopeSummary> {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateBudget()
  return useMutation({
    mutationFn: async (envelope: EnvelopeSummary) => {
      const { actionId } = await window.api.budgets.remove({ categoryId: envelope.categoryId })
      if (actionId === null) return
      toastUndoable(`Deleted the “${envelope.categoryName}” envelope`, actionId, queryClient)
    },
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}
