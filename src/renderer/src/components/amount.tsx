import { cn, formatAmount } from '@/lib/utils'
import { usePrivacy } from '@/lib/privacy'

interface AmountProps {
  /** Integer milliunits (value * 1000) */
  value: number
  currency: string
  /** Set false to skip the green/red sign coloring */
  colored?: boolean
  className?: string
}

export function Amount({ value, currency, colored = true, className }: AmountProps) {
  const { blurAmounts } = usePrivacy()

  return (
    <span
      className={cn(
        'tabular-nums',
        colored && value > 0 && 'text-green-600 dark:text-green-500',
        colored && value < 0 && 'text-red-600 dark:text-red-500',
        blurAmounts && 'blur-sm select-none',
        className
      )}
    >
      {formatAmount(value, currency)}
    </span>
  )
}
