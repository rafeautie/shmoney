import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PiggyBankIcon
} from '@hugeicons/core-free-icons'
import type { BudgetSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { AddEnvelopeDialog } from '@/components/budget/add-envelope-dialog'
import { EnvelopeList } from '@/components/budget/envelope-list'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/budget/')({
  component: BudgetPage
})

// months are 'YYYY-MM' strings throughout, matching the budget engine's buckets
function currentMonth(): string {
  return format(new Date(), 'yyyy-MM')
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return format(new Date(y, m - 1 + delta, 1), 'yyyy-MM')
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return format(new Date(y, m - 1, 1), 'MMMM yyyy')
}

// planning horizon: fills inherit forward, so anything past a year out is noise
const MAX_MONTHS_AHEAD = 12

function BudgetPage() {
  const [month, setMonth] = useState(currentMonth)
  const [addOpen, setAddOpen] = useState(false)

  const summaryQuery = useQuery({
    queryKey: ['budget-summary', month],
    queryFn: () => window.api.budgets.summary({ month }),
    placeholderData: (prev) => prev
  })
  const summary = summaryQuery.data

  const today = currentMonth()
  const maxMonth = shiftMonth(today, MAX_MONTHS_AHEAD)
  const hasEnvelopes = summary !== undefined && summary.minMonth !== null
  const prevDisabled = !hasEnvelopes || (summary.minMonth !== null && month <= summary.minMonth)
  const nextDisabled = !hasEnvelopes || month >= maxMonth

  return (
    <Page className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Budget</h2>
          <p className="text-muted-foreground">
            Envelope budgeting: fill each category monthly, and what you don't spend rolls forward.
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
          <span className="w-36 text-center text-sm font-medium">{monthLabel(month)}</span>
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
          <Button onClick={() => setAddOpen(true)}>
            <HugeiconsIcon icon={Add01Icon} size={16} />
            Add envelope
          </Button>
        </div>
      </div>

      {summary === undefined ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : summary.envelopes.length === 0 ? (
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
            <Button onClick={() => setAddOpen(true)}>
              <HugeiconsIcon icon={Add01Icon} size={16} />
              Add your first envelope
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <SummaryCards summary={summary} />
          <EnvelopeList summary={summary} />
        </>
      )}

      <AddEnvelopeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        month={month}
        budgetedIds={summary?.envelopes.map((e) => e.categoryId) ?? []}
      />
    </Page>
  )
}

function SummaryCards({ summary }: { summary: BudgetSummary }) {
  const stats = [
    { label: 'Budgeted', value: summary.totals.fill, colored: false },
    { label: 'Spent', value: summary.totals.spent, colored: false },
    // the one number where sign is the story: total rolled-forward balance
    { label: 'Available', value: summary.totals.balance, colored: true }
  ]
  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold tracking-tight">
              <Amount value={stat.value} currency={summary.currency} colored={stat.colored} />
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
