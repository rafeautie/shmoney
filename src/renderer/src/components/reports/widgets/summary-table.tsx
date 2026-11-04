import { useMemo } from 'react'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { groupTotals } from '../data'
import { CenteredNote, MeasureValue, MixedCurrencyBadge } from './shared'
import { DRILL_LABEL, DRILL_TARGET, type OnDrill } from '../use-drill'
import { displayMeasure } from './measure'
import { ACCENT_COLOR } from '@/components/charts/chart-style'
import { totalColor } from '../entity-colors'

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
  // each bar is drawn against the largest row in its currency, so the top row fills its track
  const maxByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of totals)
      map.set(t.currency, Math.max(map.get(t.currency) ?? 0, Math.abs(t.value)))
    return map
  }, [totals])

  if (totals.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  return (
    // full-bleed: the table spans the card edges; the badge stays pinned outside
    // the scroll region so it doesn't scroll away with the rows
    // a narrow card drops the % column so the names keep their room
    <div className="@container relative h-full">
      <MixedCurrencyBadge currencies={currencies} />
      <ScrollArea className="h-full">
        {/* raw <table>, not the Table wrapper: its overflow-x container would
            become the sticky header's scroll context and break stickiness */}
        <table className="w-full table-fixed caption-bottom text-xs">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="w-[6.5rem] text-right">Value</TableHead>
              <TableHead className="hidden w-12 text-right @[16rem]:table-cell">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.map((t, i) => {
              const denominator = totalByCurrency.get(t.currency) ?? 0
              const pct = denominator > 0 ? (Math.abs(t.value) / denominator) * 100 : 0
              const max = maxByCurrency.get(t.currency) ?? 0
              const width = max > 0 ? (Math.abs(t.value) / max) * 100 : 0
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
                  <TableCell className="font-medium">
                    <div className="truncate">
                      <span className={cn(onDrill && DRILL_LABEL)}>{t.label}</span>
                    </div>
                    {/* the row's share against the largest: under the name, so it
                        keeps its length however narrow the card gets */}
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${width}%`, background: totalColor(t) ?? ACCENT_COLOR }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <MeasureValue measure={measure} value={t.value} currency={t.currency} />
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums @[16rem]:table-cell">
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
