import { cn, formatAmount } from '@/lib/utils'

interface AmountProps {
  /** Integer milliunits (value * 1000) */
  value: number
  currency: string
  className?: string
}

export function Amount({ value, currency, className }: AmountProps) {
  return (
    <span
      className={cn(
        'tabular-nums',
        value > 0 && 'text-green-600 dark:text-green-500',
        value < 0 && 'text-red-600 dark:text-red-500',
        className
      )}
    >
      {formatAmount(value, currency)}
    </span>
  )
}
