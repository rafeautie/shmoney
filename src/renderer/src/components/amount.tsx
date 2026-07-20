import { cn, formatAmount, formatShares } from '@/lib/utils'
import { usePrivacy } from '@/lib/settings'

interface AmountProps {
  /** Integer milliunits (value * 1000) */
  value: number
  currency: string
  /** Set false to skip the green/red sign coloring */
  colored?: boolean
  className?: string
  /** Extra classes applied only while amounts are blurred */
  blurClassName?: string
}

export function Amount({ value, currency, colored = true, className, blurClassName }: AmountProps) {
  const { blurAmounts } = usePrivacy()

  return (
    <span
      className={cn(
        'tabular-nums duration-0',
        colored && value > 0 && 'text-green-500 dark:text-green-400',
        colored && value > 0 && blurAmounts && 'bg-green-500/20 dark:bg-green-400/20',
        colored && value < 0 && 'text-red-600 dark:text-red-500',
        colored && value < 0 && blurAmounts && 'bg-red-600/20 dark:bg-red-500/20',
        blurAmounts && 'bg-foreground/20 blur-sm select-none',
        className,
        blurAmounts && blurClassName
      )}
    >
      {formatAmount(value, currency)}
    </span>
  )
}

interface SharesProps {
  /** Exact decimal string (or number) of shares/units held */
  value: string | number
  className?: string
}

/** A share/unit count; blurred by the same privacy toggle as {@link Amount}. */
export function Shares({ value, className }: SharesProps) {
  const { blurAmounts } = usePrivacy()

  return (
    <span className={cn('tabular-nums', blurAmounts && 'blur-sm select-none', className)}>
      {formatShares(value)}
    </span>
  )
}
