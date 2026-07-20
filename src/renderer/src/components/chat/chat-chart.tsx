import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Analytics01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons'
import type { ChartData, ChartDisplay, ChartSpec, ChartToolResult } from '@shared/chat'
import { cn } from '@/lib/utils'
import { formatBucketLabel } from '@/lib/format-date'
import { usePrivacy } from '@/lib/settings'
import { Chart, type FormatValue } from '@/components/charts/chart'
import { ChatTableViewport } from '@/components/chat/chat-table'
import { ToolCallCard } from '@/components/chat/tool-call'

// A chart the model composed over its own query result, rendered from the
// persisted part (or the streamed equivalent). Values are real amounts (the
// scope views already divided milliunits out), so unlike report widgets
// nothing here divides by anything. Mapping from ChartData onto the shared
// <Chart> component's props happens in ChatChart below, since the model's
// SQL already shaped the data.

// pie slices beyond the top 8 collapse into "Other", mirroring PieChartWidget
const MAX_PIE_SLICES = 8

/** a plottable cell; anything else (a validation escape) becomes a gap */
function toNumber(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'bigint') return Number(cell)
  return null
}

/** real amounts as the scope's currency, or plain numbers when mixed/unknown */
function formatChatValue(value: number, currency: string | null, compact = false): string {
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

const cellText = (cell: unknown, isSeries: boolean, currency: string | null): string =>
  cell === null
    ? 'NULL'
    : typeof cell === 'string'
      ? formatBucketLabel(cell)
      : typeof cell === 'number' || typeof cell === 'bigint'
        ? formatChatValue(Number(cell), isSeries ? currency : null)
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
  const formatValue: FormatValue = (v, opts) => formatChatValue(v, currency, opts?.compact)

  // dataKeys use sanitized keys (x, s0, s1…) so column names with dots or
  // spaces can never break Recharts path lookup or CSS. One memo for the
  // whole pipeline: a plot recomputed on unrelated re-renders (e.g. the Data
  // toggle) hands the shared chart a new array and restarts the line
  // animation from nothing.
  const { axisData, axisSeries } = useMemo(() => {
    const xIndex = data.columns.indexOf(spec.x)
    const seriesIndexes = series.map((name) => data.columns.indexOf(name))
    if (xIndex < 0 || seriesIndexes.some((i) => i < 0)) return { axisData: [], axisSeries: [] }
    const axisData = data.rows.map((row) => {
      const entry: Record<string, string | number | null> = { x: String(row[xIndex] ?? '') }
      seriesIndexes.forEach((column, i) => {
        entry[`s${i}`] = toNumber(row[column])
      })
      return entry
    })
    const axisSeries = series.map((name, i) => ({ key: `s${i}`, label: name }))
    return { axisData, axisSeries }
  }, [data, spec, series])

  // reproduces PieChartWidget's rollup: positive slices, sorted desc, top 8
  // collapsed with the rest into "Other". Memoized for the same reason as
  // the axis plot above.
  const pieSlices = useMemo(() => {
    const xIndex = data.columns.indexOf(spec.x)
    const valueIndex = data.columns.indexOf(spec.series[0])
    if (xIndex < 0 || valueIndex < 0) return []
    const positive = data.rows
      .map((row) => ({ label: String(row[xIndex] ?? ''), value: toNumber(row[valueIndex]) ?? 0 }))
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value)
    const top = positive.slice(0, MAX_PIE_SLICES)
    const rest = positive.slice(MAX_PIE_SLICES)
    if (rest.length > 0)
      top.push({ label: 'Other', value: rest.reduce((sum, s) => sum + s.value, 0) })
    return top
  }, [data, spec])

  // one headline number, optionally with a signed period-over-period change.
  // Cheap enough to recompute every render, unlike the two plots above.
  const statRow = data.rows[0]
  const statValue = toNumber(statRow?.[data.columns.indexOf(spec.series[0])])
  const changeColumn = spec.series[1]
  const changeValue = changeColumn ? toNumber(statRow?.[data.columns.indexOf(changeColumn)]) : null
  const statChange =
    changeValue === null || !changeColumn ? null : { value: changeValue, label: changeColumn }
  const statItems =
    statValue === null ? [] : [{ value: statValue, currency, colored: false, change: statChange }]

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
        <Chart kind="stat" items={statItems} formatValue={formatValue} className="py-1" />
      ) : spec.type === 'pie' ? (
        <Chart
          kind="pie"
          data={pieSlices}
          labelKey="label"
          valueKey="value"
          formatValue={formatValue}
          className="h-56"
        />
      ) : (
        <Chart
          kind={spec.type}
          data={axisData}
          xKey="x"
          series={axisSeries}
          formatValue={formatValue}
          formatLabel={formatBucketLabel}
          colorByPoint
          legend="auto"
          className="h-56"
        />
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
                              'blur-sm select-none bg-foreground/20'
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
