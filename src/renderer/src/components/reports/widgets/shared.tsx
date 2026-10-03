import type { Measure } from '@shared/reports'
import { Amount } from '@/components/amount'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMeasureValue } from './measure'

// The report-only charts here (radar, radial, gauge, budget) pass
// isAnimationActive={false} for the same reason the shared Chart does; see the note
// at the top of components/charts/chart.tsx.

/** Shared body for chart tooltips: label on the left, formatted value on the right. */
export function TooltipRow({
  label,
  measure,
  value,
  currency,
  color
}: {
  label: React.ReactNode
  measure: Measure
  value: number
  currency: string
  color?: string
}) {
  return (
    <>
      {color && (
        <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      )}
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">
          {measure === 'count' ? (
            formatMeasureValue(measure, value, currency)
          ) : (
            <Amount value={value} currency={currency} colored={false} />
          )}
        </span>
      </div>
    </>
  )
}

/** Money renders via <Amount> (signed coloring for sums only); counts as plain text. */
export function MeasureValue({
  measure,
  value,
  currency
}: {
  measure: Measure
  value: number
  currency: string
}) {
  if (measure === 'count') return <>{formatMeasureValue(measure, value, currency)}</>
  return <Amount value={value} currency={currency} colored={measure === 'sum'} />
}

export function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <Empty className="h-full p-4">
      <EmptyDescription className="text-sm">{children}</EmptyDescription>
    </Empty>
  )
}

export function MixedCurrencyBadge({ currencies }: { currencies: string[] }) {
  if (currencies.length <= 1) return null
  return (
    <Badge variant="outline" className="absolute top-0 right-0 z-10 bg-background/80">
      Mixed currencies: {currencies.join(', ')}
    </Badge>
  )
}

export function WidgetSkeleton() {
  return (
    <div className="flex h-full flex-col justify-end gap-2 px-6 pt-2 pb-6">
      <div className="flex flex-1 items-end gap-2">
        {[40, 70, 55, 85, 60, 75].map((h, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}
