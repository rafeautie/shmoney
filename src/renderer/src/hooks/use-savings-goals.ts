import { useQuery } from '@tanstack/react-query'
import type { GoalSummary } from '@shared/goals'
import { currentMonth, shiftMonth } from '@/lib/format-date'

// What the Budget page's savings section reads. Read-only throughout: a goal's
// monthly plan is derived from its target and its target date, so the only way
// to change the plan is to change the goal, and nothing on the Budget page
// writes to one.

export interface SavingsGoalRow {
  goal: GoalSummary
  /** milliunits saved over the viewed month; the delta of two month-end levels */
  saved: number
}

export interface SavingsGoals {
  rows: SavingsGoalRow[]
  /** active goals left out because they aren't in the budget's currency */
  excluded: GoalSummary[]
  totals: { planned: number; saved: number }
  /** neededPerMonth is a fact about today, so it is a plan for now and later */
  showPlanned: boolean
  /** a future month has no transactions to read */
  showSaved: boolean
}

/**
 * The goals the Budget page shows for one month, with each one's saved figure.
 *
 * `saved` is a subtraction of two points the app already computes:
 * `savedAt(end of the viewed month)` minus `savedAt(end of the month before)`,
 * both from `goals:series` at monthly grain. The renderer's only contribution
 * is the minus sign, so a month's saving cannot drift from the goal card's
 * headline.
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
    queryKey: ['goals-series', month],
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

  // archived goals are history, not a status board; the same exclusion the
  // report widget makes
  const active = (goalsQuery.data ?? []).filter((goal) => goal.archivedAt === null)
  const included = active.filter((goal) => goal.currency === currency)

  const levels = new Map<string, number>()
  for (const row of seriesQuery.data?.rows ?? []) {
    if (row.bucket !== null && row.groupId !== null) {
      levels.set(`${row.groupId}:${row.bucket}`, row.value)
    }
  }
  // a bucket below a contributions goal's floor is absent and reads as 0, so a
  // goal started this month counts the whole of its progress
  const savedIn = (goal: GoalSummary): number =>
    (levels.get(`${goal.id}:${month}`) ?? 0) - (levels.get(`${goal.id}:${previous}`) ?? 0)

  const rows = included.map((goal) => ({ goal, saved: savedIn(goal) }))

  return {
    rows,
    excluded: active.filter((goal) => goal.currency !== currency),
    totals: {
      planned: rows.reduce((sum, row) => sum + (row.goal.neededPerMonth ?? 0), 0),
      saved: rows.reduce((sum, row) => sum + row.saved, 0)
    },
    showPlanned,
    showSaved
  }
}
