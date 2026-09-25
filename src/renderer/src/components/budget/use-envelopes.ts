import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BudgetSetFillInput, EnvelopeSummary } from '@shared/budgets'
import { ipcErrorMessage } from '@/lib/utils'

function useInvalidateBudget(): () => void {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['budget-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  }
}

export function useSetFill(): UseMutationResult<unknown, Error, BudgetSetFillInput> {
  const invalidate = useInvalidateBudget()
  return useMutation({
    mutationFn: (input: BudgetSetFillInput) => window.api.budgets.setFill(input),
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}

export function useRemoveEnvelope(): UseMutationResult<void, Error, EnvelopeSummary> {
  const invalidate = useInvalidateBudget()
  return useMutation({
    mutationFn: async (envelope: EnvelopeSummary) => {
      const { actionId } = await window.api.budgets.remove({ categoryId: envelope.categoryId })
      if (actionId === null) return
      // the removal is an action-log entry, so the toast's Undo replays the
      // same entry Ctrl+Z would — one undo path, no separate restore call
      toast(`Removed the ${envelope.categoryName} envelope`, {
        action: {
          label: 'Undo',
          onClick: () => {
            window.api.actionLog
              .undoEntry(actionId)
              .then(invalidate)
              .catch(() => {})
          }
        }
      })
    },
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}
