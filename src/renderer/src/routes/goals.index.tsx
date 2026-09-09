import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Target02Icon } from '@hugeicons/core-free-icons'
import type { GoalSummary } from '@shared/goals'
import { GoalCard } from '@/components/goals/goal-card'
import { GoalsTable } from '@/components/goals/goals-table'
import { NewGoalButton } from '@/components/goals/new-goal-dialog'
import { StatCards } from '@/components/stat-cards'
import { ViewToggle } from '@/components/view-toggle'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useMonthlySaved } from '@/hooks/use-savings-goals'
import { useAccountCurrency } from '@/lib/currency'
import { currentMonth } from '@/lib/format-date'
import { useGoalsView } from '@/lib/settings'
import { plural } from '@/lib/utils'

export const Route = createFileRoute('/goals/')({
  component: GoalsPage
})

function GoalsPage() {
  const dominantCurrency = useAccountCurrency()
  const { goalsView, setGoalsView } = useGoalsView()

  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list(),
    placeholderData: (prev) => prev
  })
  const goals = goalsQuery.data
  const savedThisMonth = useMonthlySaved(currentMonth())

  const active = goals?.filter((g) => g.archivedAt === null) ?? []
  const archived = goals?.filter((g) => g.archivedAt !== null) ?? []
  const empty = goals !== undefined && active.length === 0 && archived.length === 0

  return (
    // full-height flex column so the goals table can bleed to the app edges and
    // own its scrolling, like the budget page's envelopes
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-6 px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Goals</h2>
            <p className="text-muted-foreground">
              A target amount and the accounts the money lands in. Progress comes from your
              transactions, never typed in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ViewToggle view={goalsView} onChange={setGoalsView} />
            <NewGoalButton currency={dominantCurrency} />
          </div>
        </div>

        {active.length > 0 && <SummaryStrip goals={active} />}
      </div>

      {goals === undefined ? (
        <div className="space-y-4 px-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
              <NewGoalButton currency={dominantCurrency}>Add your first goal</NewGoalButton>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {active.length > 0 &&
            (goalsView === 'table' ? (
              <>
                <GoalsTable goals={active} savedThisMonth={savedThisMonth} />
                <p className="px-6 pt-2 text-xs text-muted-foreground">
                  Planned is what you need to put away this month to stay on pace. It rises if you
                  fall behind. Saved is what landed this month.
                </p>
              </>
            ) : (
              <div className="grid gap-4 px-6 md:grid-cols-2 xl:grid-cols-3">
                {active.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </div>
            ))}

          {archived.length > 0 && (
            <Collapsible className="pt-4">
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="ml-6 font-normal" />}
              >
                Archived · {plural(archived.length, 'goal')}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4">
                {goalsView === 'table' ? (
                  <GoalsTable goals={archived} savedThisMonth={savedThisMonth} />
                ) : (
                  <div className="grid gap-4 px-6 md:grid-cols-2 xl:grid-cols-3">
                    {archived.map((goal) => (
                      <GoalCard key={goal.id} goal={goal} />
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          <div className="h-6" />
        </ScrollArea>
      )}
    </div>
  )
}

/** Grouped by currency: goals are scalar amounts and must not be added across them. */
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
