import type { CurrencyTotal, Transaction } from '@shared/ipc'
import { dayLabel, dayNet } from '@/lib/day-groups'
import { Amount } from '@/components/amount'

export function DayHeader({
  day,
  rows,
  rest
}: {
  day: string
  rows: Transaction[]
  rest?: CurrencyTotal[]
}) {
  return (
    <div className="flex items-center justify-between gap-4 font-medium text-muted-foreground">
      <span>{dayLabel(day)}</span>
      <span className="flex gap-3">
        {dayNet(rows, rest).map(({ currency, total }) => (
          <Amount key={currency} value={total} currency={currency} />
        ))}
      </span>
    </div>
  )
}
