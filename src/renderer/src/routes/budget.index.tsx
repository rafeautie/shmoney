import { useState } from 'react'
import type { BudgetSummary } from '@shared/budgets'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon, PiggyBankIcon } from '@hugeicons/core-free-icons'
import { AddEnvelopeButton } from '@/components/budget/add-envelope-dialog'
import { EnvelopeList } from '@/components/budget/envelope-list'
import { SavingsGoalsSection } from '@/components/budget/savings-goals-section'
import { Amount } from '@/components/amount'
import { StatCards, type Stat } from '@/components/stat-cards'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useSavingsGoals, type SavingsGoals } from '@/hooks/use-savings-goals'
import { currentMonth, formatMonthLong, shiftMonth } from '@/lib/format-date'

export const Route = createFileRoute('/budget/')({
  component: BudgetPage
})

// planning horizon: fills inherit forward, so anything past a year out is noise
const MAX_MONTHS_AHEAD = 12

function BudgetPage() {
  const [month, setMonth] = useState(currentMonth)

  const summaryQuery = useQuery({
    queryKey: ['budget-summary', month],
    queryFn: () => window.api.budgets.summary({ month }),
    placeholderData: (prev) => prev
  })
  const summary = summaryQuery.data
  const budgetedIds = summary?.envelopes.map((e) => e.categoryId) ?? []
  const goals = useSavingsGoals(month, summary?.currency ?? '')

  const today = currentMonth()
  const maxMonth = shiftMonth(today, MAX_MONTHS_AHEAD)
  const hasEnvelopes = summary !== undefined && summary.minMonth !== null
  const prevDisabled = !hasEnvelopes || (summary.minMonth !== null && month <= summary.minMonth)
  const nextDisabled = !hasEnvelopes || month >= maxMonth

  return (
    // full-height flex column so the envelope table can bleed to the app
    // edges and own its scrolling, like the transactions table
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-6 px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Budget</h2>
            <p className="text-muted-foreground">
              Envelope budgeting: fill each category monthly, and what you don't spend rolls
              forward.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={prevDisabled}
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              <span className="sr-only">Previous month</span>
            </Button>
            <span className="w-36 text-center text-sm font-medium">{formatMonthLong(month)}</span>
            <Button
              variant="outline"
              size="icon"
              disabled={nextDisabled}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
              <span className="sr-only">Next month</span>
            </Button>
            {month !== today && (
              <Button variant="ghost" onClick={() => setMonth(today)}>
                Today
              </Button>
            )}
            <AddEnvelopeButton month={month} budgetedIds={budgetedIds} />
          </div>
        </div>

        {summary !== undefined && (summary.envelopes.length > 0 || goals.rows.length > 0) && (
          <StatCards stats={statCards(summary, goals)} currency={summary.currency} />
        )}
      </div>

      {summary === undefined ? (
        <div className="space-y-4 px-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : summary.envelopes.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={PiggyBankIcon} />
              </EmptyMedia>
              <EmptyTitle>No envelopes yet</EmptyTitle>
              <EmptyDescription>
                Budget a monthly amount per category. Leftovers roll forward; overspending carries a
                negative balance.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <AddEnvelopeButton month={month} budgetedIds={budgetedIds}>
                Add your first envelope
              </AddEnvelopeButton>
            </EmptyContent>
          </Empty>
          <SavingsGoalsSection
            goals={goals}
            currency={summary.currency}
            hasEnvelopes={false}
            className="-mx-6"
          />
        </div>
      ) : (
        <EnvelopeList summary={summary} className="min-h-0 flex-1">
          <SavingsGoalsSection goals={goals} currency={summary.currency} hasEnvelopes />
        </EnvelopeList>
      )}
    </div>
  )
}

/**
 * The three envelope figures, plus a fourth for savings when goals exist.
 *
 * Planned savings deliberately does not reduce `Available`. `Available` is the
 * accumulated rollover balance across every month an envelope has existed, and
 * subtracting one month's plan from a cumulative multi-month figure would
 * drift further from meaning anything with every month that passed. The
 * comparison the user came for lives in the Saved card's subcaption instead,
 * where neither number moves the other.
 */
function statCards(summary: BudgetSummary, goals: SavingsGoals): Stat[] {
  const stats: Stat[] = [
    { label: 'Budgeted', value: summary.totals.fill, colored: false },
    { label: 'Spent', value: summary.totals.spent, colored: false },
    // the one number where sign is the story: total rolled-forward balance
    { label: 'Available', value: summary.totals.balance, colored: true }
  ]
  // saved is a fact about a month that has happened; planned is a fact about
  // today. Only the current month can honestly show both.
  if (goals.rows.length > 0 && goals.showSaved) {
    stats.push({
      label: 'Saved',
      value: goals.totals.saved,
      colored: false,
      sub: goals.showPlanned ? (
        <>
          of <Amount value={goals.totals.planned} currency={summary.currency} colored={false} />{' '}
          planned
        </>
      ) : undefined
    })
  }
  return stats
}
