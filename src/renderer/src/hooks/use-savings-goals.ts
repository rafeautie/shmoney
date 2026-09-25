import { useQuery } from '@tanstack/react-query'
import type { GoalSummary } from '@shared/goals'
import { currentMonth, shiftMonth } from '@/lib/format-date'

export interface SavingsGoals {
  totals: { planned: number; saved: number }
  /** goals the totals cover: those active and in the asked-for currency */
  counted: number
  /** neededPerMonth is computed from today, so it's a plan for now and later */
  showPlanned: boolean
  /** a future month has no transactions to read */
  showSaved: boolean
}

/**
 * Milliunits saved per goal over `month`, as the delta of two `goals:series`
 * month-end levels, so there is no second formula for a month's saving to
 * drift from the goal card's headline.
 */
export function useMonthlySaved(month: string, enabled = true): Map<number, number> {
  const previous = shiftMonth(month, -1)

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
    enabled,
    placeholderData: (prev) => prev
  })

  const levels = new Map<string, number>()
  for (const row of seriesQuery.data?.rows ?? []) {
    if (row.bucket !== null && row.groupId !== null) {
      levels.set(`${row.groupId}:${row.bucket}`, row.value)
    }
  }

  // a bucket below a contributions goal's floor is absent, so a goal started
  // this month reads its whole progress as saved
  const saved = new Map<number, number>()
  for (const key of levels.keys()) {
    const [id, bucket] = key.split(':')
    if (bucket !== month) continue
    saved.set(
      Number(id),
      (levels.get(`${id}:${month}`) ?? 0) - (levels.get(`${id}:${previous}`) ?? 0)
    )
  }
  return saved
}

/** What the budget's Saved card compares: this month's saving against its plan. */
export function useSavingsGoals(month: string, currency: string): SavingsGoals {
  const today = currentMonth()
  const showPlanned = month >= today
  const showSaved = month <= today

  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list()
  })
  const saved = useMonthlySaved(month, showSaved)

  // archived goals are history, not a status board; another currency's goal
  // folded into these totals would not be any real amount
  const counted = (goalsQuery.data ?? []).filter(
    (goal: GoalSummary) => goal.archivedAt === null && goal.currency === currency
  )

  return {
    totals: {
      // a goal with no linked account has no pace to plan for
      planned: counted.reduce(
        (sum, goal) => sum + (goal.accounts.length > 0 ? (goal.neededPerMonth ?? 0) : 0),
        0
      ),
      saved: counted.reduce((sum, goal) => sum + (saved.get(goal.id) ?? 0), 0)
    },
    counted: counted.length,
    showPlanned,
    showSaved
  }
}
