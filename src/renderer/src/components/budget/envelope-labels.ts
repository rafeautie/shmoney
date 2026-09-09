import type { EnvelopeSummary } from '@shared/budgets'
import { formatAmount } from '@/lib/utils'

/** What this month's bar means in words, the way a goal card reads its pace. */
export function spendLine(envelope: EnvelopeSummary, currency: string): string {
  if (envelope.fill === 0) return 'Nothing filled for this month'
  if (envelope.spent > envelope.fill)
    return `Overspent by ${formatAmount(envelope.spent - envelope.fill, currency)} this month`
  return `${formatAmount(envelope.fill - envelope.spent, currency)} left of this month's fill`
}
