import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDownRight01Icon, ArrowUpRight01Icon, MinusSignIcon } from '@hugeicons/core-free-icons'
import {
  bucketLabelFor,
  mergeFilters,
  previousPeriod,
  type Measure,
  type QueryRow,
  type ReportFilters,
  type ReportWidget,
  type ResolvedFilters,
  type ResolvedQuery,
  type TimeGrain,
  type WidgetConfig
} from '@shared/reports'
import { cn, startOfTodayEpoch } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pivotTimeSeries, seriesKey } from '../data'
import { CenteredNote } from './shared'
import { displayMeasure, formatMeasureValue } from './measure'
import { DRILL_LABEL, DRILL_TARGET, type OnDrill } from '../use-drill'

const DAY = 86400

/** The headline figure; its cents step back so the whole units read first. */
const STAT_VALUE = 'text-2xl font-[560] tracking-[-0.02em]'
const STAT_FRACTION = 'ml-px text-[0.6em] font-medium tracking-normal opacity-60'

function totalFor(rows: QueryRow[], currency: string): number {
  return rows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.value, 0)
}

/** The same query over the window before the widget's own. */
function usePreviousPeriod(
  widgetId: number,
  config: WidgetConfig,
  reportFilters: ReportFilters,
  resolved: ResolvedQuery
) {
  const today = startOfTodayEpoch()
  const period = useMemo(
    () =>
      config.query.source === 'goals'
        ? null
        : previousPeriod(mergeFilters(reportFilters, config.filters).dateRange, today),
    [config, reportFilters, today]
  )
  const previous = useMemo(
    () =>
      period && {
        ...resolved,
        filters: { ...resolved.filters, dateStart: period.start, dateEnd: period.end }
      },
    [period, resolved]
  )
  const query = useQuery({
    queryKey: ['report-data', widgetId, 'previous', previous],
    queryFn: () => window.api.reports.runQuery(previous!),
    enabled: previous !== null,
    placeholderData: (prev) => prev
  })
  return { period, rows: query.data?.rows, isLoading: query.isLoading }
}

/**
 * When the accounts' history starts. A comparison with a window the data
 * doesn't reach measures the import date, not a change ("+47,322%"), so the
 * tile says there is nothing to compare with instead. Only the accounts matter:
 * a category with no spending last year is a real zero.
 */
function useHistoryStart(filters: ResolvedFilters, enabled: boolean): number | null | undefined {
  const query = useQuery({
    queryKey: ['report-history-start', filters.accountIds ?? null, filters.includePending],
    queryFn: async () => {
      const page = await window.api.reports.transactions({
        page: 0,
        pageSize: 1,
        sortBy: 'date',
        sortDir: 'asc',
        filters: {
          dateStart: null,
          dateEnd: null,
          accountIds: filters.accountIds,
          direction: 'all',
          includePending: filters.includePending,
          includeTransfers: true
        }
      })
      return page.rows[0]?.date ?? null
    },
    enabled
  })
  return query.data
}

/** Sparkline buckets: fine enough to show a shape, never more than a few dozen points. */
function sparkGrain(start: number | null, end: number | null): Exclude<TimeGrain, 'none'> {
  if (start === null || end === null) return 'month'
  const days = (end - start) / DAY
  return days <= 45 ? 'day' : days <= 180 ? 'week' : 'month'
}

function useSparkline(widgetId: number, resolved: ResolvedQuery, enabled: boolean) {
  const { dateStart, dateEnd } = resolved.filters
  const grain = sparkGrain(dateStart, dateEnd)
  const spark = enabled ? { ...resolved, groupBy: 'none' as const, timeGrain: grain } : null
  const query = useQuery({
    meta: { silenceError: true },
    queryKey: ['report-data', widgetId, 'sparkline', spark],
    queryFn: () => window.api.reports.runQuery(spark!),
    enabled: spark !== null,
    placeholderData: (prev) => prev
  })
  return useMemo(() => {
    const rows = query.data?.rows
    if (!rows || rows.length === 0) return null
    const pivot = pivotTimeSeries(
      rows,
      grain,
      dateStart,
      dateEnd,
      false,
      resolved.measure !== 'avg',
      startOfTodayEpoch()
    )
    const current = bucketLabelFor(grain, new Date())
    return (currency: string) => {
      const key = seriesKey(null, currency)
      const points = pivot.data.map((row) =>
        typeof row[key] === 'number' ? (row[key] as number) : null
      )
      const inProgress = pivot.data.findIndex((row) => row.bucket === current)
      return { points, inProgress }
    }
  }, [query.data, grain, dateStart, dateEnd, resolved.measure])
}

const SPARK_W = 64
const SPARK_H = 20

/** A muted trend over the finished buckets; the one in progress is left off,
 * since at a few days in it would end every line in a cliff. */
function Sparkline({ points, inProgress }: { points: (number | null)[]; inProgress: number }) {
  const finished = inProgress >= 0 ? points.slice(0, inProgress) : points
  const drawn = finished.flatMap((v, i) => (v === null ? [] : [{ i, v }]))
  if (drawn.length < 2) return null
  const values = drawn.map((p) => p.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (i: number) => 1 + (i / Math.max(1, finished.length - 1)) * (SPARK_W - 4)
  const y = (v: number) => SPARK_H - 3 - ((v - min) / (max - min || 1)) * (SPARK_H - 6)
  const path = (list: typeof drawn) =>
    list.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const end = drawn.at(-1)
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="shrink-0 overflow-visible text-muted-foreground"
      aria-hidden
    >
      <path
        d={path(drawn)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {end && <circle cx={x(end.i)} cy={y(end.v)} r={2} className="fill-foreground" />}
    </svg>
  )
}

// up is good news for money in, bad news for money out; counts and averages
// have no good direction
const UP_TONE: Partial<Record<Measure, 'good' | 'bad'>> = {
  sum: 'good',
  income: 'good',
  expense: 'bad'
}

const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0
})

/** A change past this many times the baseline reads better as "12×" than as a percent. */
const MULTIPLE_FROM = 10

function StatChange({
  measure,
  current,
  previous,
  currency,
  label,
  range
}: {
  measure: Measure
  current: number
  previous: number
  currency: string
  label: string
  range: string
}) {
  const delta = current - previous
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const tone =
    direction === 'flat' || !UP_TONE[measure]
      ? 'neutral'
      : (direction === 'up') === (UP_TONE[measure] === 'good')
        ? 'good'
        : 'bad'
  const icon =
    direction === 'up'
      ? ArrowUpRight01Icon
      : direction === 'down'
        ? ArrowDownRight01Icon
        : MinusSignIcon
  const money = (value: number) =>
    measure === 'count' ? (
      formatMeasureValue(measure, value, currency)
    ) : (
      <Amount value={value} currency={currency} colored={false} />
    )
  // a percent needs a same-signed baseline; across zero only the amount means anything
  const ratio =
    previous !== 0 && Math.sign(previous) === Math.sign(current) ? delta / Math.abs(previous) : null
  const change =
    direction === 'flat' ? (
      '0%'
    ) : ratio === null ? (
      <>
        {delta > 0 ? '+' : '−'}
        {money(Math.abs(delta))}
      </>
    ) : Math.abs(ratio) >= MULTIPLE_FROM ? (
      `${Math.round(current / previous)}×`
    ) : (
      percentFormat.format(Math.abs(ratio))
    )
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-footnote text-muted-foreground">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                'flex shrink-0 cursor-default items-center gap-0.5 rounded-full px-1.5 py-px font-medium tabular-nums',
                tone === 'good' && 'bg-positive-fill/15 text-positive',
                tone === 'bad' && 'bg-negative/12 text-negative',
                tone === 'neutral' && 'bg-muted text-muted-foreground'
              )}
            />
          }
        >
          <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
          <span className="sr-only">
            {direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change'}
          </span>
          {change}
        </TooltipTrigger>
        <TooltipContent>
          <span className="tabular-nums">
            {delta > 0 ? '+' : delta < 0 ? '−' : ''}
            {money(Math.abs(delta))} from {money(previous)}, {range}
          </span>
        </TooltipContent>
      </Tooltip>
      <span className="truncate">vs {label}</span>
    </div>
  )
}

export function StatCardWidget({
  widget,
  config,
  rows,
  currencies,
  resolved,
  reportFilters,
  onDrill
}: {
  widget: ReportWidget
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  resolved: ResolvedQuery
  reportFilters: ReportFilters
  onDrill?: OnDrill
}) {
  const measure = displayMeasure(config)
  const isGoals = config.query.source === 'goals'
  const previous = usePreviousPeriod(widget.id, config, reportFilters, resolved)
  const historyStart = useHistoryStart(resolved.filters, previous.period !== null)
  const sparkline = useSparkline(
    widget.id,
    resolved,
    !isGoals && (config.display?.sparkline ?? true)
  )
  // the group is always the goal, so summing them would answer nobody's question
  if (isGoals) {
    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 px-4 pt-2 pb-4">
          {rows.map((row) => (
            <div key={`${row.groupId}-${row.currency}`} className="min-w-0">
              <div className="truncate text-xs text-muted-foreground">{row.groupLabel}</div>
              <Amount
                value={row.value}
                currency={row.currency}
                colored={false}
                className={STAT_VALUE}
                fractionClassName={STAT_FRACTION}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    )
  }
  // one row per currency when groupBy/timeGrain are 'none'; a currency that only
  // appears in the previous window has nothing to headline, so it is left out
  const byCurrency = currencies.map((currency) => ({ currency, value: totalFor(rows, currency) }))
  if (byCurrency.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  const { period } = previous
  const range =
    period &&
    `${format(new Date(period.start * 1000), 'MMM d, yyyy')} to ${format(new Date(period.end * 1000), 'MMM d, yyyy')}`
  // the history has to reach back over the whole previous window (a day's slack
  // for an import that starts on the 2nd)
  const baseline =
    historyStart === undefined || !period
      ? 'loading'
      : historyStart === null || historyStart > period.start + DAY
        ? 'missing'
        : 'ok'
  const headline = cn(STAT_VALUE, onDrill && DRILL_LABEL)
  return (
    <div
      className={cn(
        'flex h-full flex-col items-stretch justify-start gap-2 overflow-hidden px-4 pt-2 pb-4',
        onDrill && cn(DRILL_TARGET, 'rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50')
      )}
      {...(onDrill && {
        role: 'button',
        tabIndex: 0,
        // the tile sums every bucket and group, so it opens the whole filtered list
        onClick: () => onDrill({}),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onDrill({})
        }
      })}
    >
      {byCurrency.map(({ currency, value }) => {
        const spark = sparkline?.(currency)
        return (
          <div key={currency} className="flex max-w-full min-w-0 flex-col gap-1">
            {
              // a count is not money: no currency, no sign color, and nothing to hide
              // behind the privacy dots
              measure === 'count' ? (
                <span className={cn(headline, 'self-start tabular-nums')}>
                  {formatMeasureValue(measure, value, currency)}
                </span>
              ) : (
                <Amount
                  value={value}
                  currency={currency}
                  colored={measure === 'sum'}
                  className={cn(headline, 'self-start')}
                  fractionClassName={STAT_FRACTION}
                />
              )
            }
            <div className="flex min-w-0 items-center justify-between gap-3">
              {period &&
                (baseline === 'loading' || !previous.rows ? (
                  // holds the line's height so the tile doesn't jump when it loads
                  <Skeleton className="h-4 w-32" />
                ) : baseline === 'missing' ? (
                  <span className="truncate text-footnote text-muted-foreground">
                    {historyStart
                      ? `No data before ${format(new Date(historyStart * 1000), 'MMM yyyy')}`
                      : 'Nothing to compare with'}
                  </span>
                ) : (
                  <StatChange
                    measure={config.query.measure}
                    current={value}
                    previous={totalFor(previous.rows, currency)}
                    currency={currency}
                    label={period.label}
                    range={range!}
                  />
                ))}
              {spark && <Sparkline points={spark.points} inProgress={spark.inProgress} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
