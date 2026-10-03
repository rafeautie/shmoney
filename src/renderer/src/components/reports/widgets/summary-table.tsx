import { useMemo } from 'react'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { groupTotals } from '../data'
import { CenteredNote, MeasureValue, MixedCurrencyBadge } from './shared'
import { DRILL_LABEL, DRILL_TARGET, type OnDrill } from '../use-drill'
import { displayMeasure } from './measure'

export function SummaryTableWidget({
  config,
  rows,
  currencies,
  onDrill
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  onDrill?: OnDrill
}) {
  const totals = useMemo(
    () => groupTotals(rows, config.query.sort ?? { by: 'value', dir: 'desc' }, config.query.limit),
    [rows, config.query.sort, config.query.limit]
  )
  const measure = displayMeasure(config)
  const totalByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of totals) map.set(t.currency, (map.get(t.currency) ?? 0) + Math.abs(t.value))
    return map
  }, [totals])

  if (totals.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  return (
    // full-bleed: the table spans the card edges; the badge stays pinned outside
    // the scroll region so it doesn't scroll away with the rows
    <div className="relative h-full">
      <MixedCurrencyBadge currencies={currencies} />
      <ScrollArea className="h-full">
        {/* raw <table>, not the Table wrapper: its overflow-x container would
            become the sticky header's scroll context and break stickiness */}
        <table className="w-full caption-bottom text-xs">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="w-32 text-right">Value</TableHead>
              <TableHead className="w-16 text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.map((t, i) => {
              const denominator = totalByCurrency.get(t.currency) ?? 0
              const pct = denominator > 0 ? (Math.abs(t.value) / denominator) * 100 : 0
              return (
                <TableRow
                  key={`${t.groupId}-${t.currency}-${i}`}
                  {...(onDrill && {
                    tabIndex: 0,
                    className: cn(DRILL_TARGET, 'focus-visible:bg-muted/50'),
                    onClick: () => onDrill({ groupIds: t.groupIds }),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      onDrill({ groupIds: t.groupIds })
                    }
                  })}
                >
                  <TableCell className="truncate font-medium">
                    <span className={cn(onDrill && DRILL_LABEL)}>{t.label}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <MeasureValue measure={measure} value={t.value} currency={t.currency} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {pct.toFixed(0)}%
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </table>
      </ScrollArea>
    </div>
  )
}
