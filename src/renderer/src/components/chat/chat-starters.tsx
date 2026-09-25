import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  ArrowUpDownIcon,
  ChartLineData01Icon,
  Coins01Icon,
  RepeatIcon,
  Target02Icon,
  Wallet01Icon
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { currentMonth } from '@/lib/format-date'

interface Starter {
  text: string
  /** what comes back, so the tile sets expectations before the click */
  hint: string
  icon: IconSvgElement
  tone: string
}

/**
 * Openers for a blank chat, one per worked turn the system prompt teaches, so
 * each lands on a query shape the model has seen answered. The budget and goal
 * tiles only ask about ones the user actually has; a starter that comes back
 * "you have no budgets" is a wasted first impression. The text sent is exactly
 * what the user sees.
 */
function useStarters(): Starter[] {
  const { data: goals } = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list()
  })
  const month = currentMonth()
  const { data: budget } = useQuery({
    queryKey: ['budget-summary', month],
    queryFn: () => window.api.budgets.summary({ month })
  })

  const goal = goals?.find((g) => g.archivedAt === null && g.status !== 'reached')
  const hasBudget = budget !== undefined && budget.envelopes.length > 0

  return [
    {
      text: 'How much do I spend each month?',
      hint: 'A month-by-month trend',
      icon: ChartLineData01Icon,
      tone: 'bg-chart-1/12 text-chart-1'
    },
    hasBudget
      ? {
          text: 'Am I on budget this month?',
          hint: 'Every envelope, rollover included',
          icon: Wallet01Icon,
          tone: 'bg-chart-2/15 text-chart-2'
        }
      : {
          text: 'How much of my income did I spend over the last 3 months?',
          hint: 'Spending as a share of income',
          icon: Wallet01Icon,
          tone: 'bg-chart-2/15 text-chart-2'
        },
    goal
      ? {
          text: `How's my ${goal.name} goal going?`,
          hint: 'Progress and the pace it needs',
          icon: Target02Icon,
          tone: 'bg-chart-3/15 text-chart-3'
        }
      : {
          text: 'How much did I save each month this year?',
          hint: 'Income minus spending, by month',
          icon: Target02Icon,
          tone: 'bg-chart-3/15 text-chart-3'
        },
    {
      text: 'What subscriptions am I paying for?',
      hint: 'Charges that repeat every month',
      icon: RepeatIcon,
      tone: 'bg-chart-5/12 text-chart-5'
    },
    {
      text: 'What changed in my spending last month?',
      hint: 'Categories against the month before',
      icon: ArrowUpDownIcon,
      tone: 'bg-chart-4/12 text-chart-4'
    },
    {
      text: 'Am I earning more than I spend?',
      hint: 'Income against spending',
      icon: Coins01Icon,
      tone: 'bg-chart-3/15 text-chart-3'
    }
  ]
}

/** The blank-chat state: a short header over a grid of starter tiles. */
export function ChatStarters({
  onPick,
  disabled
}: {
  /** send a starter prompt; omit to show the header alone */
  onPick?: (prompt: string) => void
  disabled?: boolean
}) {
  const starters = useStarters()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-medium">Ask about your money</h2>
          <p className="text-sm text-muted-foreground">
            Answered on this device. Nothing leaves your computer.
          </p>
        </header>
        {onPick && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {starters.map((starter) => (
              <button
                key={starter.text}
                type="button"
                disabled={disabled}
                onClick={() => onPick(starter.text)}
                className="flex flex-col items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-ring/60 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                <span
                  className={cn('flex size-8 items-center justify-center rounded-lg', starter.tone)}
                >
                  <HugeiconsIcon icon={starter.icon} className="size-4" strokeWidth={2} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm/snug font-medium">{starter.text}</span>
                  <span className="text-xs text-muted-foreground">{starter.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
