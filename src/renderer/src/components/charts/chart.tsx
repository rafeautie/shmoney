import { useId, useMemo, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Rectangle,
  XAxis,
  YAxis,
  type BarShapeProps,
  type MouseHandlerDataParam
} from 'recharts'
import { cn } from '@/lib/utils'
import { PrivateText } from '@/components/amount'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { ACCENT_COLOR, POINT_COLOR, paletteColor } from './chart-style'
import { HOVER_FADE, useHoverDim } from './hover-dim'
import { niceScale } from './nice-ticks'
import { privateTick } from './private-tick'

// The one chart-drawing surface shared by the report widgets and the chat
// charts. It owns the house style — axes, tooltip, legend, palette, per-point
// coloring, privacy mask — for the chart family both surfaces have in common
// (line / bar / area / pie / stat). Report-only widgets (radar, radial, gauge,
// budget) keep their own drawing in components/reports/widgets.
//
// It stays unit-agnostic: callers inject `formatValue`, so chat can pass real
// amounts and report widgets can pass milliunits without either data pipeline
// leaking into here. `currency` rides through `formatValue`'s options so a
// multi-currency report chart formats each series/slice in its own currency;
// single-currency callers just ignore it.
//
// Every series passes isAnimationActive={false}. Recharts starts a new animation
// whenever the geometry it computes changes by reference, which during a resize is
// every frame, so an animated chart crawls along behind the pointer instead of
// tracking it. Charts draw at their final geometry, like any other DOM element.
//
// Hovering a series (or slice, or per-point bar) in the plot or the legend dims
// everything else.

type ChartRow = Record<string, string | number | null>

/** value → display text; `compact` for axis ticks, `currency` for per-series formatting. */
export type FormatValue = (
  value: number,
  opts?: { compact?: boolean; currency?: string | null }
) => string

export interface ChartSeries {
  /** field in each data row; also the CSS --color-<key> key (must be [a-zA-Z0-9_-]) */
  key: string
  label: string
  /** per-series currency (report time series); omit for single-currency callers */
  currency?: string | null
  /** a fixed color (the entity's own); palette order otherwise */
  color?: string
}

export interface StatItem {
  value: number
  currency?: string | null
  /** green/red by sign (report sums); never for counts */
  colored?: boolean
  /** a signed secondary line under the headline (chat's period-over-period change) */
  change?: { value: number; label: string } | null
  /** false for counts: skip the privacy mask and sign coloring. Default true. */
  sensitive?: boolean
}

/** A click on a mark: the datum's index, and for bars the series it belongs to
 * (null where a click picks a whole x position: line and area charts, pie slices). */
export type OnSelect = (index: number, seriesKey: string | null) => void

interface CommonProps {
  formatValue: FormatValue
  /** passthrough to the chart's root (height/aspect/padding); callers own outer layout */
  className?: string
}

interface CartesianProps {
  kind: 'line' | 'bar' | 'area'
  data: ChartRow[]
  xKey: string
  series: ChartSeries[]
  /** x-axis + tooltip label formatter (bucket → "Jan 2026"); identity by default */
  formatLabel?: (label: string) => string
  stacked?: boolean
  /** true | false | 'auto' (auto shows the legend when there's more than one series). Default 'auto'. */
  legend?: boolean | 'auto'
  /** single-series bars colored per point (categorical breakdowns) vs one color (time series). */
  colorByPoint?: boolean
  /** 'series' = top label + one row per series (time series); 'point' = a single row labelled by the datum. Default 'series'. */
  tooltipMode?: 'series' | 'point'
  /** false for counts: skip the y-axis privacy mask. Default true. */
  sensitive?: boolean
  onSelect?: OnSelect
  /** the datum for a period still in progress (this month so far): drawn hatched
   * (bars) or dashed (lines) and noted in its tooltip so its short total doesn't
   * read as a drop */
  inProgressIndex?: number
  /** where the period in progress is headed, per series key: the dashed tail runs
   * to it (lines, areas) and bars get a dashed outline up to it */
  projection?: Record<string, number> | null
  /** the window before, aligned by index with `data` and keyed like it: drawn as a
   * faint dashed ghost and listed in the tooltip */
  previous?: { rows: ChartRow[]; label: string } | null
}

interface PieProps {
  kind: 'pie'
  /** pre-rolled slices (positive, sorted, top-N + "Other"); colored here by order */
  data: ChartRow[]
  /** slice label field (legend + tooltip) */
  labelKey: string
  /** slice value field */
  valueKey: string
  /** default true */
  legend?: boolean
  donut?: boolean
  /** false for counts: skip the tooltip blur. Default true. */
  sensitive?: boolean
  onSelect?: OnSelect
}

interface StatProps {
  kind: 'stat'
  items: StatItem[]
}

export type ChartProps = CommonProps & (CartesianProps | PieProps | StatProps)

export function Chart(props: ChartProps) {
  switch (props.kind) {
    case 'pie':
      return <PieView {...props} />
    case 'stat':
      return <StatBlock {...props} />
    default:
      return <CartesianView {...props} />
  }
}

// ---------- shared pieces ----------

/** A formatted value hidden by the privacy toggle (and optional signed color). */
function ValueText({
  value,
  currency,
  formatValue,
  colored = false,
  sensitive = true,
  className
}: {
  value: number
  currency?: string | null
  formatValue: FormatValue
  colored?: boolean
  sensitive?: boolean
  className?: string
}) {
  return (
    <PrivateText
      text={formatValue(value, { currency })}
      sensitive={sensitive}
      className={cn(
        'tabular-nums',
        sensitive && colored && value > 0 && 'text-positive',
        sensitive && colored && value < 0 && 'text-negative',
        className
      )}
    />
  )
}

/** Shared tooltip body: swatch, label on the left, formatted value on the right,
 * with the projection and the previous period's value under it when there are any. */
function TooltipRow({
  label,
  value,
  currency,
  color,
  formatValue,
  sensitive,
  projected,
  previous
}: {
  label: ReactNode
  value: number
  currency?: string | null
  color?: string
  formatValue: FormatValue
  sensitive?: boolean
  projected?: number | null
  previous?: { value: number | null; label: string } | null
}) {
  const note = (text: string, v: number) => (
    <span className="flex gap-1 text-caption text-muted-foreground">
      {text}
      <ValueText value={v} currency={currency} formatValue={formatValue} sensitive={sensitive} />
    </span>
  )
  return (
    <>
      {color && (
        <div className="mt-px size-2 shrink-0 rounded-full" style={{ background: color }} />
      )}
      <div className="flex flex-1 items-start justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex flex-col items-end gap-1">
          <ValueText
            value={value}
            currency={currency}
            formatValue={formatValue}
            sensitive={sensitive}
            className="font-mono font-medium"
          />
          {projected != null && note('projected', projected)}
          {previous?.value != null && note(previous.label, previous.value)}
        </span>
      </div>
    </>
  )
}

/** Defensive fallback for degenerate data; callers guard real empty states themselves. */
function ChartNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-muted-foreground italic">{children}</p>
}

// ---------- line / bar / area ----------

const BAR_RADIUS = 3
const BAR_TOP_RADIUS: [number, number, number, number] = [BAR_RADIUS, BAR_RADIUS, 0, 0]
const BAR_GAP = '30%'

const IN_PROGRESS_OPACITY = 0.4
const IN_PROGRESS_DASH = '4 3'
const GHOST_DASH = '2 3'
const AREA_TOP_OPACITY = 0.28
const AREA_BOTTOM_OPACITY = 0.02
const SOLID = '__solid'
const TAIL = '__tail'
const PREV = '__prev'
const PREV_TOTAL = '__prevTotal'
const PREV_LABEL = '__prevLabel'
// the stretch a bar in progress still has to grow to reach its projection
const REMAINDER = '__rem'
// a 2px line is too thin to hover, so each series gets an invisible wide twin
const LINE_HIT_WIDTH = 12

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A dot drawn at one index only: a line's end, or the projected point. */
function pointDot(index: number, color: string, hollow: boolean, opacity: number) {
  return function renderDot(props: { index?: number; cx?: number; cy?: number }) {
    if (props.index !== index || props.cx == null || props.cy == null) {
      return <g key={`dot-${props.index}`} />
    }
    return (
      <circle
        key={`dot-${props.index}`}
        cx={props.cx}
        cy={props.cy}
        r={hollow ? 3 : 2.5}
        fill={hollow ? 'var(--card)' : color}
        stroke={color}
        strokeWidth={hollow ? 1.5 : 0}
        opacity={opacity}
      />
    )
  }
}

function CartesianView({
  kind,
  data,
  xKey,
  series,
  formatValue,
  formatLabel,
  stacked = false,
  legend = 'auto',
  colorByPoint = false,
  tooltipMode = 'series',
  sensitive = true,
  onSelect,
  inProgressIndex,
  projection,
  previous,
  className
}: CartesianProps & CommonProps) {
  const { active, setActive, clear, shown, hover } = useHoverDim()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  if (data.length === 0 || series.length === 0) return <ChartNote>Nothing to chart.</ChartNote>

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: s.color ?? paletteColor(i) }])
  )
  const labelFmt = formatLabel ?? ((l: string) => l)
  const valueTick = privateTick((value) => formatValue(value, { compact: true }), sensitive)
  const showLegend = legend === 'auto' ? series.length > 1 : legend
  const singleSeries = series.length === 1
  // a categorical breakdown lays its bars sideways so every category label gets
  // its own row; along a horizontal axis Recharts drops labels that would overlap.
  // minTickGap={0} on the category axis skips a label only when its row is
  // shorter than the text, which beats piling labels on top of each other
  const horizontal = kind === 'bar' && colorByPoint && singleSeries
  const inProgressLabel =
    inProgressIndex !== undefined && inProgressIndex >= 0 && inProgressIndex < data.length
      ? data[inProgressIndex][xKey]
      : null
  // a lone point has nothing to read as a drop against, so it stays solid
  const inProgress = inProgressLabel !== null && data.length > 1 ? inProgressIndex! : null
  const proj = inProgress !== null && projection ? projection : null
  const projectedAt = (s: ChartSeries, row: ChartRow) => num(proj?.[s.key]) ?? num(row[s.key])

  // the previous window's values, and how far each bar in progress still has
  // to grow, ride along in the rows under suffixed keys
  const rows: ChartRow[] = data.map((row, i) => {
    const out: ChartRow = { ...row }
    if (previous) {
      const prev = previous.rows[i]
      let total: number | null = null
      for (const s of series) {
        const v = num(prev?.[s.key])
        out[s.key + PREV] = v
        if (v !== null) total = (total ?? 0) + v
      }
      out[PREV_TOTAL] = total
      out[PREV_LABEL] = prev?.[xKey] ?? null
    }
    if (kind === 'bar' && proj && i === inProgress) {
      const grow = (actual: number, target: number) =>
        actual >= 0 && target > actual ? target - actual : null
      if (stacked) {
        const actual = series.reduce((sum, s) => sum + (num(row[s.key]) ?? 0), 0)
        const target = series.reduce((sum, s) => sum + (projectedAt(s, row) ?? 0), 0)
        out[REMAINDER] = grow(actual, target)
      } else {
        for (const s of series) {
          out[s.key + REMAINDER] = grow(num(row[s.key]) ?? 0, projectedAt(s, row) ?? 0)
        }
      }
    }
    return out
  })

  // round ticks over everything drawn: stacks, projections and the ghost
  const extent: number[] = []
  rows.forEach((row, i) => {
    const values = series.map((s) => num(row[s.key]) ?? 0)
    const ahead = i === inProgress && proj ? series.map((s) => projectedAt(s, row) ?? 0) : null
    if (stacked) {
      for (const set of ahead ? [values, ahead] : [values]) {
        extent.push(
          set.filter((v) => v > 0).reduce((a, b) => a + b, 0),
          set.filter((v) => v < 0).reduce((a, b) => a + b, 0)
        )
      }
      const prevTotal = num(row[PREV_TOTAL])
      if (prevTotal !== null) extent.push(prevTotal)
    } else {
      extent.push(...values, ...(ahead ?? []))
      for (const s of series) {
        const v = num(row[s.key + PREV])
        if (v !== null) extent.push(v)
      }
    }
  })
  const scale = niceScale(
    Math.min(...extent),
    Math.max(...extent),
    extent.every((v) => Number.isInteger(v))
  )

  // a line or area dashes the stretch leading into the period in progress: each
  // series splits into a solid run and a tail sharing the point before it
  const splitLine = inProgress !== null && inProgress > 0 && kind !== 'bar'
  const lineData = splitLine
    ? rows.map((row, i) => ({
        ...row,
        ...Object.fromEntries(
          series.flatMap((s) => [
            [s.key + SOLID, i < inProgress ? row[s.key] : null],
            [
              s.key + TAIL,
              i === inProgress ? projectedAt(s, row) : i === inProgress - 1 ? row[s.key] : null
            ]
          ])
        )
      }))
    : rows
  const lastIndex = data.length - 1
  // the last point drawn solid gets a dot; a projected end gets a hollow one
  const endIndex = splitLine ? inProgress - 1 : lastIndex
  // per row, the last series with a value: the segment drawn at the top of its stack
  const stackTops = rows.map((row) =>
    row[REMAINDER] != null
      ? REMAINDER
      : (series.findLast((s) => Number(row[s.key] ?? 0) !== 0)?.key ?? null)
  )

  const valueAxis = {
    tickLine: false,
    axisLine: false,
    tick: valueTick,
    domain: scale.domain,
    ticks: scale.ticks,
    interval: 0 as const
  }
  const axes = horizontal ? (
    <>
      <CartesianGrid horizontal={false} />
      <XAxis type="number" tickMargin={8} {...valueAxis} />
      <YAxis
        type="category"
        dataKey={xKey}
        tickLine={false}
        axisLine={false}
        width="auto"
        minTickGap={0}
        tickFormatter={labelFmt}
      />
    </>
  ) : (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey={xKey}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={24}
        tickFormatter={labelFmt}
      />
      <YAxis width={56} {...valueAxis} />
    </>
  )
  const tooltip =
    tooltipMode === 'point' ? (
      <ChartTooltip
        content={
          <ChartTooltipContent
            hideLabel
            formatter={(value, _name, item) => (
              <TooltipRow
                label={item.payload?.[xKey]}
                value={value as number}
                currency={item.payload?.currency}
                formatValue={formatValue}
                sensitive={sensitive}
              />
            )}
          />
        }
      />
    ) : (
      <ChartTooltip
        content={
          <ChartTooltipContent
            labelFormatter={(l) =>
              typeof l !== 'string' ? (
                l
              ) : l === inProgressLabel ? (
                <>
                  {labelFmt(l)}
                  <div className="font-normal text-muted-foreground">In progress</div>
                </>
              ) : (
                labelFmt(l)
              )
            }
            formatter={(value, name, item) => {
              const key = name as string
              const s = series.find((x) => x.key === key)
              const inProgressRow = item.payload?.[xKey] === inProgressLabel
              return (
                <TooltipRow
                  color={item.color}
                  label={chartConfig[key]?.label ?? name}
                  value={value as number}
                  currency={s?.currency ?? item.payload?.currency}
                  formatValue={formatValue}
                  sensitive={sensitive}
                  projected={inProgressRow && s ? num(proj?.[s.key]) : null}
                  previous={
                    previous
                      ? {
                          value: num(item.payload?.[key + PREV]),
                          label:
                            typeof item.payload?.[PREV_LABEL] === 'string'
                              ? labelFmt(item.payload[PREV_LABEL])
                              : previous.label
                        }
                      : null
                  }
                />
              )
            }}
          />
        }
      />
    )
  const colorOf = (s: ChartSeries) => `var(--color-${s.key})`
  const endDot = (s: ChartSeries) => pointDot(endIndex, colorOf(s), false, shown(s.key))
  // split series draw as a solid run and a dashed tail, plus an unstroked copy
  // over the whole range that carries the tooltip, legend entry and hover dot
  const lineMarks = series.flatMap((s) => {
    const color = colorOf(s)
    // a single-bucket range has no segment to stroke, so the chart looks
    // empty; show the dot in that case while keeping multi-point lines clean
    const dot = data.length <= 1 ? true : endDot(s)
    if (!splitLine) {
      return [
        <Line
          key={s.key}
          dataKey={s.key}
          type="monotone"
          stroke={color}
          strokeOpacity={shown(s.key)}
          strokeWidth={2}
          dot={dot}
          activeDot={{ opacity: shown(s.key) }}
          isAnimationActive={false}
        />
      ]
    }
    const part = (suffix: string, dash?: string) => (
      <Line
        key={s.key + suffix}
        dataKey={s.key + suffix}
        type="monotone"
        stroke={color}
        strokeOpacity={shown(s.key)}
        strokeWidth={2}
        strokeDasharray={dash}
        dot={
          suffix === SOLID
            ? endDot(s)
            : proj
              ? pointDot(inProgress, color, true, shown(s.key))
              : false
        }
        activeDot={false}
        tooltipType="none"
        legendType="none"
        isAnimationActive={false}
      />
    )
    return [
      part(SOLID),
      part(TAIL, IN_PROGRESS_DASH),
      <Line
        key={s.key}
        dataKey={s.key}
        type="monotone"
        stroke={color}
        strokeOpacity={0}
        activeDot={{ opacity: shown(s.key) }}
        strokeWidth={2}
        dot={false}
        isAnimationActive={false}
      />
    ]
  })
  const lineHits = series.map((s) => (
    <Line
      key={s.key + '__hit'}
      dataKey={s.key}
      type="monotone"
      stroke="transparent"
      strokeWidth={LINE_HIT_WIDTH}
      dot={false}
      activeDot={false}
      tooltipType="none"
      legendType="none"
      isAnimationActive={false}
      {...hover(s.key)}
    />
  ))
  const fillId = (s: ChartSeries, suffix = '') => `${uid}-fill-${s.key}${suffix}`
  const hatchId = (s: ChartSeries) => `${uid}-hatch-${s.key}`
  // areas fade toward the baseline so the line carries the data and the fill the volume
  const defs = (
    <defs>
      {kind === 'area' &&
        series.flatMap((s) =>
          [
            ['', 1],
            [TAIL, IN_PROGRESS_OPACITY]
          ].map(([suffix, k]) => (
            <linearGradient
              key={s.key + suffix}
              id={fillId(s, suffix as string)}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={colorOf(s)}
                stopOpacity={AREA_TOP_OPACITY * (k as number)}
              />
              <stop offset="100%" stopColor={colorOf(s)} stopOpacity={AREA_BOTTOM_OPACITY} />
            </linearGradient>
          ))
        )}
      {kind === 'bar' &&
        inProgress !== null &&
        series.map((s) => (
          <pattern
            key={s.key}
            id={hatchId(s)}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill={colorOf(s)} fillOpacity={0.25} />
            <line x1="0" y1="0" x2="0" y2="5" stroke={colorOf(s)} strokeWidth="2.5" />
          </pattern>
        ))}
    </defs>
  )
  const areaMarks = series.flatMap((s) => {
    const color = colorOf(s)
    // a single-bucket range has no area to draw; show the dot so it's visible
    const dot = data.length <= 1 ? true : endDot(s)
    if (!splitLine) {
      return [
        <Area
          key={s.key}
          dataKey={s.key}
          type="monotone"
          stroke={color}
          strokeOpacity={shown(s.key)}
          strokeWidth={2}
          fill={`url(#${fillId(s)})`}
          fillOpacity={shown(s.key)}
          stackId={stacked ? 'stack' : s.key}
          dot={dot}
          activeDot={{ opacity: shown(s.key) }}
          isAnimationActive={false}
          {...hover(s.key)}
        />
      ]
    }
    // each part stacks only with its own kind, so every stack sums the same series
    const part = (suffix: string, dash?: string) => (
      <Area
        key={s.key + suffix}
        dataKey={s.key + suffix}
        type="monotone"
        stroke={color}
        strokeOpacity={shown(s.key)}
        strokeWidth={2}
        strokeDasharray={dash}
        fill={`url(#${fillId(s, suffix === TAIL ? TAIL : '')})`}
        fillOpacity={shown(s.key)}
        stackId={stacked ? suffix : s.key + suffix}
        dot={
          suffix === SOLID
            ? endDot(s)
            : proj
              ? pointDot(inProgress, color, true, shown(s.key))
              : false
        }
        activeDot={false}
        tooltipType="none"
        legendType="none"
        isAnimationActive={false}
        {...hover(s.key)}
      />
    )
    return [
      part(SOLID),
      part(TAIL, IN_PROGRESS_DASH),
      <Area
        key={s.key}
        dataKey={s.key}
        type="monotone"
        stroke={color}
        strokeOpacity={0}
        activeDot={{ opacity: shown(s.key) }}
        fill="none"
        stackId={stacked ? 'stack' : s.key}
        dot={false}
        isAnimationActive={false}
      />
    ]
  })
  // the previous window: one faint line per series, or a single line for the
  // total where the marks stack (a ghost per segment would mean nothing)
  const ghostTotal = stacked || kind === 'bar'
  const ghostLine = (key: string, color: string, opacity: number) => (
    <Line
      key={key}
      dataKey={key}
      type="monotone"
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={1.5}
      strokeDasharray={GHOST_DASH}
      dot={false}
      activeDot={false}
      tooltipType="none"
      legendType="none"
      isAnimationActive={false}
    />
  )
  const ghosts = !previous
    ? null
    : ghostTotal
      ? kind === 'bar' && !stacked && !singleSeries
        ? null
        : ghostLine(PREV_TOTAL, 'var(--muted-foreground)', 0.8)
      : series.map((s) => ghostLine(s.key + PREV, colorOf(s), 0.55 * shown(s.key)))
  const legendEl = showLegend ? (
    <ChartLegend content={<ChartLegendContent activeKey={active} onActiveChange={setActive} />} />
  ) : null
  // bars report their own series; a line or area click picks the hovered x position
  const barClick = (key: string) =>
    onSelect ? (_bar: unknown, index: number) => onSelect(index, key) : undefined
  const chartClick = onSelect
    ? (state: MouseHandlerDataParam) => {
        const index = Number(state.activeTooltipIndex)
        if (Number.isInteger(index) && index >= 0 && index < data.length) {
          onSelect(index, singleSeries ? series[0].key : null)
        }
      }
    : undefined
  const remainderBar = (key: string, stackId: string, color: string) => (
    <Bar
      key={key}
      dataKey={key}
      stackId={stackId}
      fill="transparent"
      stroke={color}
      strokeOpacity={0.7}
      strokeDasharray="3 2"
      radius={BAR_TOP_RADIUS}
      tooltipType="none"
      legendType="none"
      isAnimationActive={false}
    />
  )

  return (
    <ChartContainer
      config={chartConfig}
      className={cn(
        'aspect-auto w-full',
        onSelect &&
          (kind === 'bar'
            ? '[&_.recharts-bar-rectangle]:cursor-pointer'
            : '[&_.recharts-surface]:cursor-pointer'),
        HOVER_FADE,
        className
      )}
      onMouseLeave={clear}
    >
      {kind === 'line' ? (
        <LineChart data={lineData} margin={{ top: 8, right: 8 }} onClick={chartClick}>
          {axes}
          {tooltip}
          {legendEl}
          {ghosts}
          {lineMarks}
          {lineHits}
        </LineChart>
      ) : kind === 'area' ? (
        <AreaChart data={lineData} margin={{ top: 8, right: 8 }} onClick={chartClick}>
          {defs}
          {axes}
          {tooltip}
          {legendEl}
          {ghosts}
          {areaMarks}
        </AreaChart>
      ) : (
        <BarChart
          data={rows}
          layout={horizontal ? 'vertical' : 'horizontal'}
          // the value axis ends on a round tick at the plot's edge; leave its label room
          margin={{ top: 8, right: horizontal ? 20 : 8 }}
          barCategoryGap={BAR_GAP}
        >
          {defs}
          {axes}
          {tooltip}
          {legendEl}
          {horizontal ? (
            // a breakdown is one series: one accent, unless a datum brings its own
            // color (Uncategorized and "Other" go neutral)
            <Bar
              dataKey={series[0].key}
              radius={[0, BAR_RADIUS, BAR_RADIUS, 0]}
              isAnimationActive={false}
              onClick={barClick(series[0].key)}
              onMouseEnter={(_bar, i) => setActive(String(i))}
              onMouseLeave={clear}
            >
              {data.map((row, i) => (
                <Cell
                  key={i}
                  fill={(row[POINT_COLOR] as string | undefined) ?? series[0].color ?? ACCENT_COLOR}
                  fillOpacity={shown(String(i))}
                />
              ))}
            </Bar>
          ) : (
            series.flatMap((s) => {
              const stackId = stacked ? 'stack' : s.key
              const bar = (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={colorOf(s)}
                  fillOpacity={shown(s.key)}
                  stackId={stackId}
                  radius={BAR_TOP_RADIUS}
                  // in a stack only the segment on top gets the rounded corners,
                  // and the bar in progress is hatched
                  shape={(props: BarShapeProps) => (
                    <Rectangle
                      {...props}
                      radius={
                        (
                          stacked
                            ? stackTops[props.index] === s.key
                            : rows[props.index][s.key + REMAINDER] == null
                        )
                          ? BAR_TOP_RADIUS
                          : 0
                      }
                      fill={props.index === inProgress ? `url(#${hatchId(s)})` : colorOf(s)}
                      fillOpacity={shown(s.key)}
                    />
                  )}
                  isAnimationActive={false}
                  onClick={barClick(s.key)}
                  {...hover(s.key)}
                />
              )
              if (!proj) return [bar]
              if (stacked) return [bar]
              return [bar, remainderBar(s.key + REMAINDER, stackId, colorOf(s))]
            })
          )}
          {!horizontal &&
            proj &&
            stacked &&
            remainderBar(REMAINDER, 'stack', 'var(--muted-foreground)')}
          {ghosts}
        </BarChart>
      )}
    </ChartContainer>
  )
}

// ---------- pie / donut ----------

function PieView({
  data,
  labelKey,
  valueKey,
  formatValue,
  legend = true,
  donut = false,
  sensitive = true,
  onSelect,
  className
}: PieProps & CommonProps) {
  const { active, setActive, clear, shown } = useHoverDim()
  // slices carry an explicit fill so Recharts colors each by order
  const slices = useMemo(
    () =>
      data.map((row, i) => ({
        ...row,
        fill: (row[POINT_COLOR] as string | null) ?? paletteColor(i)
      })),
    [data]
  )
  if (data.length === 0) return <ChartNote>Nothing to chart.</ChartNote>

  // keyed by slice label: the legend looks entries up by the datum's nameKey
  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((row) => [String(row[labelKey]), { label: String(row[labelKey]) }])
  )
  return (
    <ChartContainer
      config={chartConfig}
      className={cn(
        'aspect-auto w-full',
        onSelect && '[&_.recharts-pie-sector]:cursor-pointer',
        HOVER_FADE,
        className
      )}
      onMouseLeave={clear}
    >
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <TooltipRow
                  label={item.payload?.[labelKey]}
                  value={value as number}
                  currency={item.payload?.currency}
                  formatValue={formatValue}
                  sensitive={sensitive}
                />
              )}
            />
          }
        />
        {legend ? (
          <ChartLegend
            content={
              <ChartLegendContent
                nameKey={labelKey}
                activeKey={active}
                onActiveChange={setActive}
              />
            }
          />
        ) : null}
        <Pie
          data={slices}
          dataKey={valueKey}
          nameKey={labelKey}
          innerRadius={donut ? '55%' : 0}
          strokeWidth={2}
          isAnimationActive={false}
          onClick={onSelect ? (_slice, index) => onSelect(index, null) : undefined}
          onMouseEnter={(_slice, index) => setActive(String(data[index][labelKey]))}
          onMouseLeave={clear}
        >
          {data.map((row, i) => (
            <Cell key={i} fillOpacity={shown(String(row[labelKey]))} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}

// ---------- stat (headline numbers, optionally with a signed change) ----------

function StatBlock({ items, formatValue, className }: StatProps & CommonProps) {
  if (items.length === 0) return <ChartNote>Nothing to chart.</ChartNote>
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-1">
          <ValueText
            value={item.value}
            currency={item.currency}
            formatValue={formatValue}
            colored={item.colored}
            sensitive={item.sensitive ?? true}
            className="text-2xl font-[560] tracking-[-0.02em]"
          />
          {item.change && (
            <div className="flex items-center gap-1.5">
              <ValueText
                value={item.change.value}
                currency={item.currency}
                formatValue={(value, opts) =>
                  `${item.change!.value > 0 ? '+' : ''}${formatValue(value, opts)}`
                }
                colored
                className="font-medium"
              />
              <span className="text-muted-foreground">{item.change.label}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
