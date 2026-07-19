import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Analytics01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis
} from 'recharts'
import type { ChartData, ChartDisplay, ChartSpec, ChartToolResult } from '@shared/chat'
import { cn } from '@/lib/utils'
import { formatBucketLabel } from '@/lib/format-date'
import { usePrivacy } from '@/lib/settings'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { BLUR_Y_TICK_LABELS, paletteColor } from '@/components/reports/chart-style'
import { ChatTableViewport } from '@/components/chat/chat-table'
import { ToolCallCard } from '@/components/chat/tool-call'

// A chart the model composed over its own query result, rendered from the
// persisted part (or the streamed equivalent). Values are real amounts (the
// scope views already divided milliunits out), so unlike report widgets
// nothing here divides by anything. Reuses the report charts' foundation —
// ChartContainer theming, the --chart palette, the privacy blur — while
// mapping columns straight onto Recharts, since the model's SQL already
// shaped the data.

// pie slices beyond the top 8 collapse into "Other", mirroring PieChartWidget
const MAX_PIE_SLICES = 8

/** a plottable cell; anything else (a validation escape) becomes a gap */
function toNumber(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'bigint') return Number(cell)
  return null
}

/** real amounts as the scope's currency, or plain numbers when mixed/unknown */
function formatValue(value: number, currency: string | null, compact = false): string {
  const options: Intl.NumberFormatOptions = compact
    ? { notation: 'compact' }
    : { maximumFractionDigits: 2 }
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        ...options
      }).format(value)
    } catch {
      // non-ISO code: fall through to the plain-number form
    }
  }
  return new Intl.NumberFormat(undefined, options).format(value)
}

/** the never-crash fallback for a part that doesn't add up (shouldn't happen: calls are validated) */
function ChartNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-muted-foreground italic">{children}</p>
}

function TooltipValue({
  label,
  value,
  currency,
  color
}: {
  label: React.ReactNode
  value: number
  currency: string | null
  color?: string
}) {
  const { blurAmounts } = usePrivacy()
  return (
    <>
      {color && (
        <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      )}
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn('font-mono font-medium tabular-nums', blurAmounts && 'blur-sm select-none')}
        >
          {formatValue(value, currency)}
        </span>
      </div>
    </>
  )
}

// ---------- line / bar (an x axis plus one series per value column) ----------

function AxisChart({
  spec,
  series,
  data,
  currency
}: {
  spec: ChartSpec
  /** resolved series labels (display.series when present); columns of data */
  series: string[]
  data: ChartData
  currency: string | null
}) {
  const { blurAmounts } = usePrivacy()
  // dataKeys and CSS color vars use sanitized keys (x, s0, s1…) so column
  // names with dots or spaces can never break Recharts path lookup or CSS.
  // One memo for the whole pipeline: a plot recomputed on unrelated re-renders
  // (e.g. the Data toggle) hands Recharts a new array and restarts the line
  // animation from nothing.
  const { xIndex, seriesIndexes, plot } = useMemo(() => {
    const xIndex = data.columns.indexOf(spec.x)
    const seriesIndexes = series.map((name) => data.columns.indexOf(name))
    const plot = data.rows.map((row) => {
      const entry: Record<string, unknown> = { x: String(row[xIndex] ?? '') }
      seriesIndexes.forEach((column, i) => {
        entry[`s${i}`] = toNumber(row[column])
      })
      return entry
    })
    return { xIndex, seriesIndexes, plot }
  }, [data, spec, series])
  if (xIndex < 0 || seriesIndexes.some((i) => i < 0) || plot.length === 0)
    return <ChartNote>Nothing to chart.</ChartNote>

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((name, i) => [`s${i}`, { label: name, color: paletteColor(i) }])
  )
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="x"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={24}
        tickFormatter={formatBucketLabel}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(value: number) => formatValue(value, currency, true)}
      />
    </>
  )
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(label) => (typeof label === 'string' ? formatBucketLabel(label) : label)}
          formatter={(value, name, item) => (
            <TooltipValue
              color={item.color}
              label={chartConfig[name as string]?.label ?? name}
              value={value as number}
              currency={currency}
            />
          )}
        />
      }
    />
  )
  // one series reads from the title; a legend only earns its space with several
  const legend = series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null

  return (
    <ChartContainer
      config={chartConfig}
      className={cn('aspect-auto h-56 w-full', blurAmounts && BLUR_Y_TICK_LABELS)}
    >
      {spec.type === 'line' ? (
        <LineChart data={plot} margin={{ top: 8, right: 8 }}>
          {axes}
          {tooltip}
          {legend}
          {series.map((_name, i) => (
            <Line
              key={i}
              dataKey={`s${i}`}
              type="monotone"
              stroke={`var(--color-s${i})`}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={plot} margin={{ top: 8, right: 8 }}>
          {axes}
          {tooltip}
          {legend}
          {series.length === 1 ? (
            // a single-series breakdown colors per bar, like the report's
            // categorical bar chart
            <Bar dataKey="s0" radius={[2, 2, 0, 0]}>
              {plot.map((_entry, i) => (
                <Cell key={i} fill={paletteColor(i)} />
              ))}
            </Bar>
          ) : (
            series.map((_name, i) => (
              <Bar key={i} dataKey={`s${i}`} fill={`var(--color-s${i})`} radius={[2, 2, 0, 0]} />
            ))
          )}
        </BarChart>
      )}
    </ChartContainer>
  )
}

// ---------- pie ----------

function PieChartPart({
  spec,
  data,
  currency
}: {
  spec: ChartSpec
  data: ChartData
  currency: string | null
}) {
  const xIndex = data.columns.indexOf(spec.x)
  const valueIndex = data.columns.indexOf(spec.series[0])
  const slices = useMemo(() => {
    const positive = data.rows
      .map((row) => ({ label: String(row[xIndex] ?? ''), value: toNumber(row[valueIndex]) ?? 0 }))
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value)
    const top = positive.slice(0, MAX_PIE_SLICES)
    const rest = positive.slice(MAX_PIE_SLICES)
    if (rest.length > 0)
      top.push({ label: 'Other', value: rest.reduce((sum, s) => sum + s.value, 0) })
    return top.map((slice, i) => ({ ...slice, fill: paletteColor(i) }))
  }, [data.rows, xIndex, valueIndex])
  if (xIndex < 0 || valueIndex < 0) return <ChartNote>Nothing to chart.</ChartNote>
  if (slices.length === 0) return <ChartNote>No positive values to chart.</ChartNote>

  // keyed by slice label: the legend looks entries up by the datum's nameKey
  const chartConfig: ChartConfig = Object.fromEntries(
    slices.map((slice) => [slice.label, { label: slice.label }])
  )
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <TooltipValue
                  label={item.payload?.label}
                  value={value as number}
                  currency={currency}
                />
              )}
            />
          }
        />
        {/* unlabeled slices are unreadable, so the pie always carries its legend */}
        <ChartLegend content={<ChartLegendContent nameKey="label" />} />
        <Pie data={slices} dataKey="value" nameKey="label" strokeWidth={2} />
      </PieChart>
    </ChartContainer>
  )
}

// ---------- stat (one headline number, optionally with a signed change) ----------

function StatPart({
  spec,
  data,
  currency
}: {
  spec: ChartSpec
  data: ChartData
  currency: string | null
}) {
  const { blurAmounts } = usePrivacy()
  const row = data.rows[0]
  const value = toNumber(row?.[data.columns.indexOf(spec.series[0])])
  const changeColumn = spec.series[1]
  const change = changeColumn ? toNumber(row?.[data.columns.indexOf(changeColumn)]) : null
  if (value === null) return <ChartNote>Nothing to chart.</ChartNote>

  return (
    <div className="flex flex-col gap-1 py-1">
      <div
        className={cn(
          'text-3xl font-semibold tracking-tight tabular-nums',
          blurAmounts && 'blur-sm select-none'
        )}
      >
        {formatValue(value, currency)}
      </div>
      {change !== null && (
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'font-medium tabular-nums',
              change > 0 && 'text-green-600 dark:text-green-500',
              change < 0 && 'text-red-600 dark:text-red-500',
              change === 0 && 'text-muted-foreground',
              blurAmounts && 'blur-sm select-none'
            )}
          >
            {change > 0 ? '+' : ''}
            {formatValue(change, currency)}
          </span>
          {/* the column's alias is the only context the spec carries for the change */}
          <span className="text-muted-foreground">{changeColumn}</span>
        </div>
      )}
    </div>
  )
}

const cellText = (cell: unknown, isSeries: boolean, currency: string | null): string =>
  cell === null
    ? 'NULL'
    : typeof cell === 'string'
      ? formatBucketLabel(cell)
      : typeof cell === 'number' || typeof cell === 'bigint'
        ? formatValue(Number(cell), isSeries ? currency : null)
        : String(cell)

/**
 * One chart part in the transcript: a titled card the same family as
 * ChatTable. `asOf` (the message's createdAt) marks the snapshot's age —
 * the data underneath keeps moving, and an old chart shouldn't pretend to be
 * current — and the Data toggle opens the exact rows the chart is drawn
 * from, so any chart can be audited in place.
 */
function ChatChart({
  spec,
  series,
  data,
  currency,
  asOf
}: {
  spec: ChartSpec
  /** resolved series labels; spec.series unless a pivot renamed the lines */
  series: string[]
  data: ChartData
  currency: string | null
  /** unix ms the chart was generated; omit while streaming (it's live) */
  asOf?: number
}) {
  const [showData, setShowData] = useState(false)
  const { blurAmounts } = usePrivacy()
  const seriesIndexes = new Set(series.map((name) => data.columns.indexOf(name)))
  return (
    <div
      data-slot="chat-chart"
      className="overflow-hidden rounded-lg border bg-muted/30 p-3 text-xs"
    >
      <div className="flex items-start justify-between gap-2 pb-2">
        <div className="font-medium">{spec.title}</div>
        <div className="flex shrink-0 items-center gap-2.5">
          {asOf !== undefined && (
            <span className="text-muted-foreground">as of {format(asOf, 'MMM d, yyyy')}</span>
          )}
          <button
            type="button"
            onClick={() => setShowData((v) => !v)}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            Data
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className={cn('size-3.5 transition-transform', showData && 'rotate-180')}
            />
          </button>
        </div>
      </div>
      {spec.type === 'stat' ? (
        <StatPart spec={spec} data={data} currency={currency} />
      ) : spec.type === 'pie' ? (
        <PieChartPart spec={spec} data={data} currency={currency} />
      ) : (
        <AxisChart spec={spec} series={series} data={data} currency={currency} />
      )}
      {showData && (
        // escape the card's padding so the table runs flush to its edges
        <div className="-mx-3 -mb-3 mt-3">
          <ChatTableViewport>
            <table>
              <thead>
                <tr>
                  {data.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>
                        {/* blur an inner span, not the cell, so the table's
                            borders stay crisp; see AssistantBubble for the
                            clip-path rationale */}
                        <span
                          className={cn(
                            'inline-block',
                            blurAmounts &&
                              seriesIndexes.has(j) &&
                              'blur-sm select-none [clip-path:inset(0)]'
                          )}
                        >
                          {cellText(cell, seriesIndexes.has(j), currency)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ChatTableViewport>
        </div>
      )}
    </div>
  )
}

/**
 * One chart call in the transcript, straight off its part — pending (no
 * result yet: the model is still writing the call) or settled — the only
 * chart entry point the transcript uses, so streaming and persisted rows
 * can't drift apart. The standard tool card carries the call (input = the
 * spec, output = the tiny result the model got back); the chart itself
 * renders below it, since the chart is the deliverable, not the call record.
 * asOf is the turn's age, which belongs to the message rather than to the
 * call, so it arrives beside the part fields.
 */
export function ChartCard({
  spec,
  result,
  display,
  asOf
}: {
  /** absent while the model is still writing the call's params */
  spec?: ChartSpec
  result?: ChartToolResult
  /** null when the call failed validation: nothing to draw */
  display?: ChartDisplay | null
  asOf?: number
}) {
  const drawn = result?.ok === true && display != null && spec !== undefined
  const failed = result !== undefined && !drawn
  const card = (
    <ToolCallCard
      icon={Analytics01Icon}
      label={!result ? 'Building chart…' : failed ? 'Chart failed' : 'Built chart'}
      active={!result}
      failed={failed}
      input={spec}
      output={
        result
          ? failed
            ? { ok: false, error: result.error ?? 'Chart failed.' }
            : { ok: true }
          : undefined
      }
    />
  )
  if (!drawn) return card
  return (
    <div className="flex flex-col gap-1.5">
      {card}
      <ChatChart
        spec={spec}
        // the one back-compat seam: parts persisted before the pivot existed
        // carry no resolved series in their JSON, so fall back to the spec's
        series={display.series ?? spec.series}
        data={display.data}
        currency={display.currency}
        asOf={asOf}
      />
    </div>
  )
}
