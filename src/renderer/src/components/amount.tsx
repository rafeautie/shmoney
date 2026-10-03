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
        colored && value > 0 && 'text-positive',
        colored && value > 0 && blurAmounts && 'bg-positive/20',
        colored && value < 0 && 'text-negative',
        colored && value < 0 && blurAmounts && 'bg-negative/20',
        // figures are the user's data wherever they appear (cards, headers,
        // tooltips), so they select; a blurred one is hidden, not readable
        blurAmounts ? 'bg-foreground/20 blur-sm select-none' : 'select-text',
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
    <span
      className={cn('tabular-nums', blurAmounts ? 'blur-sm select-none' : 'select-text', className)}
    >
      {formatShares(value)}
    </span>
  )
}
