import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowUpRight01Icon,
  RepeatIcon,
  SparklesIcon,
  Target02Icon
} from '@hugeicons/core-free-icons'
import { currentMonth } from '@/lib/format-date'

interface StarterGroup {
  label: string
  icon: IconSvgElement
  prompts: string[]
}

/**
 * Openers for a blank chat, one per worked turn the system prompt teaches, so
 * each lands on a query shape the model has seen answered. The Plans prompts
 * only ask about budgets and goals the user actually has; a starter that comes
 * back "you have no budgets" is a wasted first impression. The text sent is
 * exactly what the user sees.
 */
function useStarterGroups(): StarterGroup[] {
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
      label: 'Spending',
      icon: Analytics01Icon,
      prompts: [
        'How much do I spend each month?',
        'What did I spend the most on last month?',
        'Am I spending more this month than last?'
      ]
    },
    {
      label: 'Plans',
      icon: Target02Icon,
      prompts: [
        hasBudget
          ? 'Am I on budget this month?'
          : 'How much of my income did I spend over the last 3 months?',
        goal ? `How's my ${goal.name} goal going?` : 'How much did I save each month this year?',
        'Am I earning more than I spend?'
      ]
    },
    {
      label: 'Patterns',
      icon: RepeatIcon,
      prompts: [
        'What subscriptions am I paying for?',
        'What do I typically spend in a month?',
        'What changed in my spending last month?'
      ]
    }
  ]
}

/** The blank-chat state: a short header over the starter prompts, grouped by topic. */
export function ChatStarters({
  onPick,
  disabled
}: {
  /** send a starter prompt; omit to show the header alone */
  onPick?: (prompt: string) => void
  disabled?: boolean
}) {
  const groups = useStarterGroups()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto flex w-full max-w-2xl flex-col gap-8 p-6">
        <header className="flex flex-col items-center gap-1.5 text-center text-balance">
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HugeiconsIcon icon={SparklesIcon} className="size-5" strokeWidth={2} />
          </div>
          <h2 className="text-lg font-medium">Ask about your money</h2>
          <p className="max-w-sm text-sm/relaxed text-muted-foreground">
            Answered on this device. Nothing leaves your computer.
          </p>
        </header>
        {onPick && (
          <div className="grid gap-3 sm:grid-cols-3">
            {groups.map((group) => (
              <section
                key={group.label}
                aria-label={group.label}
                className="flex flex-col rounded-xl border bg-card/50 p-1.5"
              >
                <h3 className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
                  <HugeiconsIcon icon={group.icon} className="size-3.5" strokeWidth={2} />
                  {group.label}
                </h3>
                {group.prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(prompt)}
                    className="group flex items-start gap-2 rounded-lg px-2 py-2 text-left text-sm/snug text-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="line-clamp-2 flex-1">{prompt}</span>
                    <HugeiconsIcon
                      icon={ArrowUpRight01Icon}
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      strokeWidth={2}
                    />
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
