import { Link } from '@tanstack/react-router'
import { Amount } from '@/components/amount'
import { GoalBar, GoalStatusBadge } from '@/components/goals/goal-progress'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SavingsGoals } from '@/hooks/use-savings-goals'
import { cn, TABLE_BLEED } from '@/lib/utils'

// The Budget page's savings tie-in: goals as figures and links back to /goals,
// never as something this page can edit.

/**
 * Goals as their own section below the envelope table, never as envelope rows:
 * `Monthly fill`, `This month` and `Available` mean rollover-specific things a
 * goal has no version of, and filing a goal under those headers would make the
 * columns mean two things depending on the row.
 */
export function SavingsGoalsSection({
  goals,
  currency,
  hasEnvelopes,
  className
}: {
  goals: SavingsGoals
  currency: string
  hasEnvelopes: boolean
  className?: string
}) {
  const { rows, excluded, totals, showPlanned, showSaved } = goals

  if (rows.length === 0 && excluded.length === 0) {
    // the page already owns an empty state; a second Empty block stacked under
    // it would read as an error rather than as an invitation
    if (!hasEnvelopes) return null
    return (
      <p className={cn('px-6 py-4 text-xs text-muted-foreground', className)}>
        No savings goals yet.{' '}
        <Link to="/goals" className="underline underline-offset-2">
          Create a goal
        </Link>
      </p>
    )
  }

  return (
    <div className={cn('pt-6', className)}>
      <div className="flex items-end justify-between gap-4 px-6 pb-2">
        <div>
          <h3 className="text-sm font-medium">Savings goals</h3>
          {/* the one visible consequence of having no rollover here: the pace
              line is the rollover, computed rather than carried forward */}
          <p className="text-xs text-muted-foreground">
            What you need to put away this month to stay on pace. It rises if you fall behind.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {showPlanned && (
            <span>
              Planned <Amount value={totals.planned} currency={currency} colored={false} />
            </span>
          )}
          {showSaved && (
            <span>
              Saved <Amount value={totals.saved} currency={currency} colored={false} />
            </span>
          )}
          <Link to="/goals" className="underline underline-offset-2">
            Goals
          </Link>
        </div>
      </div>

      <table className={cn('w-full caption-bottom text-xs', TABLE_BLEED)}>
        <TableHeader>
          <TableRow>
            <TableHead>Goal</TableHead>
            {/* a column that would be a guess is simply not drawn */}
            {showPlanned && <TableHead className="w-28 text-right">Planned</TableHead>}
            {showSaved && <TableHead className="w-28 text-right">Saved</TableHead>}
            <TableHead className="w-72">Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ goal, saved }) => (
            <TableRow key={goal.id}>
              <TableCell>
                <Link to="/goals" className="truncate hover:underline">
                  {goal.name}
                </Link>
              </TableCell>
              {goal.accounts.length === 0 ? (
                <TableCell
                  colSpan={1 + Number(showPlanned) + Number(showSaved)}
                  className="text-muted-foreground"
                >
                  Link an account to start tracking this goal
                </TableCell>
              ) : (
                <>
                  {showPlanned && (
                    <TableCell className="text-right">
                      {/* undated goals are real savings with no plan: a dash, not a zero */}
                      {goal.neededPerMonth === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Amount
                          value={goal.neededPerMonth}
                          currency={goal.currency}
                          colored={false}
                        />
                      )}
                    </TableCell>
                  )}
                  {showSaved && (
                    <TableCell className="text-right">
                      <Amount value={saved} currency={goal.currency} colored={false} />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <GoalBar goal={goal} className="min-w-0 flex-1" />
                      <GoalStatusBadge status={goal.status} />
                    </div>
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </table>

      {excluded.length > 0 && (
        // folding a euro goal into a dollar total would produce a number that is
        // not any real amount, so it is named here rather than added in
        <p className="px-6 pt-2 text-xs text-muted-foreground">
          Not shown, in another currency: {excluded.map((goal) => goal.name).join(', ')}.
        </p>
      )}
    </div>
  )
}
