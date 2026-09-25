import { format } from 'date-fns'
import type { GoalSummary } from '@shared/goals'
import { formatAmount } from '@/lib/utils'

// One wording for a goal's mode and pace, shared by every view of it.

/** Which number the view is showing. */
export function modeLabel(goal: GoalSummary): string {
  const accounts = goal.accounts.map((a) => a.name).join(', ')
  if (goal.accounts.length === 0) return 'No linked account yet'
  return goal.mode === 'balance'
    ? `Balance of ${accounts}`
    : `New savings since ${format(new Date(goal.startedAt * 1000), 'd MMM yyyy')}`
}

export function paceLine(goal: GoalSummary): string {
  if (goal.status === 'reached') return 'Reached'
  if (goal.accounts.length === 0) return 'Link an account to start tracking this goal'
  if (goal.neededPerMonth !== null && goal.targetDate !== null)
    return `Save ${formatAmount(goal.neededPerMonth, goal.currency)}/month to reach it by ${longDay(goal.targetDate)}`
  if (goal.projectedDate !== null)
    return `At ${formatAmount(goal.averagePerMonth, goal.currency)}/month you'll get there around ${longDay(goal.projectedDate)}`
  if (goal.status === 'overdue') return 'Past its target date'
  return 'No pace yet: nothing saved toward it'
}

/** Read as a local day, never as UTC. */
export function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return format(new Date(y, m - 1, d), 'd MMM yyyy')
}
