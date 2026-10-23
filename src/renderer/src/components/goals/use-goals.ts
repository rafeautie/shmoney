import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { GoalCreateInput, GoalSummary, GoalUpdateInput } from '@shared/goals'
import { ipcErrorMessage } from '@/lib/utils'
import { toastUndoable } from '@/lib/undo-toast'

// every goal cache hangs off the 'goals' root (the list, the Budget series, the
// widget series) so one invalidation reaches all of them
function useInvalidateGoals(): () => void {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] })
    void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  }
}

export function useCreateGoal(): UseMutationResult<GoalSummary, Error, GoalCreateInput> {
  const invalidate = useInvalidateGoals()
  return useMutation({
    mutationFn: (input: GoalCreateInput) => window.api.goals.create(input),
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}

export function useUpdateGoal(): UseMutationResult<GoalSummary, Error, GoalUpdateInput> {
  const invalidate = useInvalidateGoals()
  return useMutation({
    mutationFn: (input: GoalUpdateInput) => window.api.goals.update(input),
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}

export function useRemoveGoal(): UseMutationResult<void, Error, GoalSummary> {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateGoals()
  return useMutation({
    mutationFn: async (goal: GoalSummary) => {
      const { actionId } = await window.api.goals.remove({ id: goal.id })
      if (actionId === null) return
      toastUndoable(`Deleted “${goal.name}”`, actionId, queryClient)
    },
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: invalidate
  })
}
