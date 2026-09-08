import { useQuery } from '@tanstack/react-query'
import type { GoalSummary } from '@shared/goals'
import { currentMonth, shiftMonth } from '@/lib/format-date'

export interface SavingsGoalRow {
  goal: GoalSummary
  /** milliunits saved over the viewed month */
  saved: number
}

export interface SavingsGoals {
  rows: SavingsGoalRow[]
  /** active goals left out because they aren't in the budget's currency */
  excluded: GoalSummary[]
  totals: { planned: number; saved: number }
  /** neededPerMonth is computed from today, so it's a plan for now and later */
  showPlanned: boolean
  /** a future month has no transactions to read */
  showSaved: boolean
}

/**
 * `saved` is the delta of two `goals:series` month-end levels, so there is no
 * second formula for a month's saving to drift from the goal card's headline.
 */
export function useSavingsGoals(month: string, currency: string): SavingsGoals {
  const today = currentMonth()
  const showPlanned = month >= today
  const showSaved = month <= today
  const previous = shiftMonth(month, -1)

  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list()
  })

  const seriesQuery = useQuery({
    queryKey: ['goals', 'series', month],
    queryFn: () => {
      const [y, m] = month.split('-').map(Number)
      return window.api.goals.series({
        timeGrain: 'month',
        dateStart: Math.floor(new Date(y, m - 2, 1).getTime() / 1000),
        dateEnd: Math.floor(new Date(y, m, 0, 23, 59, 59).getTime() / 1000)
      })
    },
    enabled: showSaved,
    placeholderData: (prev) => prev
  })

  // archived goals are history, not a status board
  const active = (goalsQuery.data ?? []).filter((goal) => goal.archivedAt === null)
  const included = active.filter((goal) => goal.currency === currency)

  const levels = new Map<string, number>()
  for (const row of seriesQuery.data?.rows ?? []) {
    if (row.bucket !== null && row.groupId !== null) {
      levels.set(`${row.groupId}:${row.bucket}`, row.value)
    }
  }
  // a bucket below a contributions goal's floor is absent, so a goal started
  // this month reads its whole progress as saved
  const savedIn = (goal: GoalSummary): number =>
    (levels.get(`${goal.id}:${month}`) ?? 0) - (levels.get(`${goal.id}:${previous}`) ?? 0)

  const rows = included.map((goal) => ({ goal, saved: savedIn(goal) }))

  return {
    rows,
    excluded: active.filter((goal) => goal.currency !== currency),
    totals: {
      // a goal with no linked account renders a prompt to relink instead of a
      // Planned cell, so counting it here would show a figure no row accounts for
      planned: rows.reduce(
        (sum, row) => sum + (row.goal.accounts.length > 0 ? (row.goal.neededPerMonth ?? 0) : 0),
        0
      ),
      saved: rows.reduce((sum, row) => sum + row.saved, 0)
    },
    showPlanned,
    showSaved
  }
}
