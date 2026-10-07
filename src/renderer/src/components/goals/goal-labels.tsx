import type { ReactNode } from 'react'
import { format } from 'date-fns'
import type { GoalSummary } from '@shared/goals'
import { Amount } from '@/components/amount'

// One wording for a goal's mode and pace, shared by every view of it.

/** Which number the view is showing. */
export function modeLabel(goal: GoalSummary): string {
  const accounts = goal.accounts.map((a) => a.name).join(', ')
  if (goal.accounts.length === 0) return 'No linked account yet'
  return goal.mode === 'balance'
    ? `Balance of ${accounts}`
    : `New savings since ${format(new Date(goal.startedAt * 1000), 'd MMM yyyy')}`
}

/** The pace sentence; its figures hide with the rest under Hide amounts. */
export function paceLine(goal: GoalSummary): ReactNode {
  const perMonth = (value: number): ReactNode => (
    <Amount value={value} currency={goal.currency} colored={false} />
  )
  if (goal.status === 'reached') return 'Reached'
  if (goal.accounts.length === 0) return 'Link an account to start tracking this goal'
  if (goal.neededPerMonth !== null && goal.targetDate !== null)
    return <>Save {perMonth(goal.neededPerMonth)}/month to reach it on time</>
  if (goal.projectedDate !== null)
    return (
      <>
        At {perMonth(goal.averagePerMonth)}/month you&apos;ll get there around{' '}
        {longDay(goal.projectedDate)}
      </>
    )
  if (goal.status === 'overdue') return 'Past its target date'
  return 'No pace yet: nothing saved toward it'
}

/** Read as a local day, never as UTC. */
export function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return format(new Date(y, m - 1, d), 'd MMM yyyy')
}
