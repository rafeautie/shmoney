import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Target02Icon } from '@hugeicons/core-free-icons'
import type { GoalSummary } from '@shared/goals'
import { GoalCard } from '@/components/goals/goal-card'
import { NewGoalCard } from '@/components/goals/new-goal-card'
import { StatCards } from '@/components/stat-cards'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccountCurrency } from '@/lib/currency'
import { plural } from '@/lib/utils'

export const Route = createFileRoute('/goals/')({
  component: GoalsPage
})

function GoalsPage() {
  const [drafting, setDrafting] = useState(false)
  const dominantCurrency = useAccountCurrency()

  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list(),
    placeholderData: (prev) => prev
  })
  const goals = goalsQuery.data

  const active = goals?.filter((g) => g.archivedAt === null) ?? []
  const archived = goals?.filter((g) => g.archivedAt !== null) ?? []

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Goals</h2>
          <p className="text-muted-foreground">
            A target amount and the accounts the money lands in. Progress comes from your
            transactions, never typed in.
          </p>
        </div>
        <Button onClick={() => setDrafting(true)} disabled={drafting}>
          New goal
        </Button>
      </div>

      {active.length > 0 && <SummaryStrip goals={active} />}

      {goals === undefined ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : active.length === 0 && archived.length === 0 && !drafting ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Target02Icon} />
            </EmptyMedia>
            <EmptyTitle>No savings goals yet</EmptyTitle>
            <EmptyDescription>
              Point a goal at the account your savings land in. Track its balance, or count only
              what you put away from today.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setDrafting(true)}>Add your first goal</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {drafting && (
              <NewGoalCard currency={dominantCurrency} onDone={() => setDrafting(false)} />
            )}
            {active.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </div>

          {archived.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="font-normal" />}
              >
                Archived · {plural(archived.length, 'goal')}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {archived.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Saved, target and what the dated goals still need each month. Grouped by
 * currency, the same per-currency treatment net worth gets on Accounts: goals
 * are scalar amounts and adding two currencies together would produce a figure
 * that is not any real amount. In practice this is one row.
 */
function SummaryStrip({ goals }: { goals: GoalSummary[] }) {
  const currencies = [...new Set(goals.map((g) => g.currency))].sort()
  return (
    <div className="space-y-4">
      {currencies.map((currency) => {
        const inCurrency = goals.filter((g) => g.currency === currency)
        return (
          <StatCards
            key={currency}
            currency={currency}
            stats={[
              {
                label: 'Saved',
                value: inCurrency.reduce((sum, g) => sum + g.progress, 0),
                colored: false
              },
              {
                label: 'Target',
                value: inCurrency.reduce((sum, g) => sum + g.targetAmount, 0),
                colored: false
              },
              {
                label: 'Needed per month',
                value: inCurrency.reduce((sum, g) => sum + (g.neededPerMonth ?? 0), 0),
                colored: false
              }
            ]}
          />
        )
      })}
    </div>
  )
}
