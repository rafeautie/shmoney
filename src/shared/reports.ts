import { z } from 'zod'
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  getQuarter,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subWeeks,
  subYears
} from 'date-fns'
import { idSchema, transactionSortBySchema } from './ipc'

// ---------- filters ----------

export const dateRangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  // unix seconds, inclusive bounds
  z.object({ kind: z.literal('absolute'), start: z.number().int(), end: z.number().int() }),
  z.object({
    kind: z.literal('relative'),
    unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
    /** "last N units" */
    count: z.number().int().min(1).max(120),
    /** whether the current (partial) unit counts as one of the N */
    includeCurrent: z.boolean()
  })
])
export type DateRange = z.infer<typeof dateRangeSchema>

// no defaults here: this shape doubles as the widget-override schema, where an
// absent field must stay absent (a defaulted field would count as an override)
const filterFieldsSchema = z.object({
  dateRange: dateRangeSchema,
  /** undefined = all accounts */
  accountIds: z.array(idSchema).optional(),
  /** undefined = all categories */
  categoryIds: z.array(idSchema).optional(),
  /** pairs with categoryIds: also match rows with no category */
  includeUncategorized: z.boolean().optional(),
  categoryGroupIds: z.array(idSchema).optional(),
  // sign of the amount; transfers are governed by includeTransfers and the
  // category filter (the Transfers system category is pickable there)
  direction: z.enum(['all', 'income', 'expense']),
  /** milliunits, compared against abs(amount) */
  amountMin: z.number().int().optional(),
  amountMax: z.number().int().optional(),
  descriptionSearch: z.string().trim().optional(),
  /**
   * Broad free-text matched against description, account name, and category
   * name. Amounts are deliberately excluded: substring-matching milliunits is
   * noise; the amount range filter covers amounts precisely.
   */
  search: z.string().trim().optional(),
  includePending: z.boolean(),
  /** rows in the Transfers system category; reports exclude them by default */
  includeTransfers: z.boolean()
})

export const reportFiltersSchema = filterFieldsSchema.extend({
  direction: filterFieldsSchema.shape.direction.default('all'),
  includePending: filterFieldsSchema.shape.includePending.default(true),
  includeTransfers: filterFieldsSchema.shape.includeTransfers.default(false)
})
export type ReportFilters = z.infer<typeof reportFiltersSchema>

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  dateRange: { kind: 'relative', unit: 'month', count: 12, includeCurrent: true },
  direction: 'all',
  includePending: true,
  includeTransfers: false
}

export const widgetFiltersSchema = z.object({
  /** 'own' ignores the report filter bar entirely */
  mode: z.enum(['inherit', 'own']),
  /** field-level: a defined field here replaces the report's value outright */
  overrides: filterFieldsSchema.partial()
})
export type WidgetFilters = z.infer<typeof widgetFiltersSchema>

/** Field-level replace, not intersect: a widget can narrow or broaden the report bar. */
export function mergeFilters(report: ReportFilters, widget: WidgetFilters): ReportFilters {
  const base = widget.mode === 'own' ? DEFAULT_REPORT_FILTERS : report
  const merged = { ...base }
  for (const [key, value] of Object.entries(widget.overrides)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

export function overriddenFilterKeys(widget: WidgetFilters): (keyof ReportFilters)[] {
  return Object.entries(widget.overrides)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key as keyof ReportFilters)
}

// ---------- widget query & config ----------

/** sum = signed net; income = positives only; expense = abs(negatives) */
export const measureSchema = z.enum(['sum', 'count', 'avg', 'income', 'expense'])
export type Measure = z.infer<typeof measureSchema>

export const groupBySchema = z.enum(['none', 'category', 'categoryGroup', 'account'])
export type GroupBy = z.infer<typeof groupBySchema>

export const timeGrainSchema = z.enum(['none', 'day', 'week', 'month', 'quarter', 'year'])
export type TimeGrain = z.infer<typeof timeGrainSchema>

export const widgetTypeSchema = z.enum([
  'line',
  'bar',
  'area',
  'pie',
  'radar',
  'radial',
  'stat',
  'summaryTable',
  'transactions',
  'budget'
])
export type WidgetType = z.infer<typeof widgetTypeSchema>

export const widgetQuerySchema = z.object({
  measure: measureSchema,
  groupBy: groupBySchema,
  timeGrain: timeGrainSchema,
  /** running total; applied in the renderer after zero-fill */
  cumulative: z.boolean().default(false),
  sort: z.object({ by: z.enum(['value', 'label']), dir: z.enum(['asc', 'desc']) }).optional(),
  /** top-N for pie / summary table; remainder rolls up into "Other" */
  limit: z.number().int().min(1).max(50).optional()
})
export type WidgetQuery = z.infer<typeof widgetQuerySchema>

/** budget widgets: which visualization of the envelope summary to render */
export const budgetViewSchema = z.enum(['list', 'bars', 'balances', 'donut', 'radial'])
export type BudgetView = z.infer<typeof budgetViewSchema>

export const widgetConfigSchema = z.object({
  query: widgetQuerySchema,
  filters: widgetFiltersSchema,
  display: z
    .object({
      stacked: z.boolean().optional(),
      donut: z.boolean().optional(),
      showLegend: z.boolean().optional(),
      budgetView: budgetViewSchema.optional()
    })
    .optional()
})
export type WidgetConfig = z.infer<typeof widgetConfigSchema>

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  query: { measure: 'expense', groupBy: 'none', timeGrain: 'month', cumulative: false },
  filters: { mode: 'inherit', overrides: {} }
}

// ---------- resolved query (what crosses IPC) ----------

export const resolvedFiltersSchema = reportFiltersSchema.omit({ dateRange: true }).extend({
  /** unix seconds, inclusive; null = unbounded */
  dateStart: z.number().int().nullable(),
  dateEnd: z.number().int().nullable()
})
export type ResolvedFilters = z.infer<typeof resolvedFiltersSchema>

export const resolvedQuerySchema = widgetQuerySchema
  .pick({ measure: true, groupBy: true, timeGrain: true })
  .extend({ filters: resolvedFiltersSchema })
export type ResolvedQuery = z.infer<typeof resolvedQuerySchema>

/**
 * Resolve a relative/absolute range to inclusive unix-second bounds.
 * `nowSec` should be a stable epoch (e.g. start of today) so memoized
 * resolutions — and the React Query keys built from them — stay stable all day.
 */
export function resolveDateRange(
  range: DateRange,
  nowSec: number
): { start: number | null; end: number | null } {
  if (range.kind === 'all') return { start: null, end: null }
  if (range.kind === 'absolute') return { start: range.start, end: range.end }

  const now = new Date(nowSec * 1000)
  const fns = {
    day: { start: startOfDay, end: endOfDay, sub: subDays },
    week: {
      start: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
      end: (d: Date) => endOfWeek(d, { weekStartsOn: 1 }),
      sub: subWeeks
    },
    month: { start: startOfMonth, end: endOfMonth, sub: subMonths },
    quarter: { start: startOfQuarter, end: endOfQuarter, sub: subQuarters },
    year: { start: startOfYear, end: endOfYear, sub: subYears }
  }[range.unit]

  const lastUnit = range.includeCurrent ? now : fns.sub(now, 1)
  const firstUnit = fns.sub(lastUnit, range.count - 1)
  return {
    start: Math.floor(fns.start(firstUnit).getTime() / 1000),
    end: Math.floor(fns.end(lastUnit).getTime() / 1000)
  }
}

/** Merge widget filters into report filters and resolve dates — ready for reports:runQuery. */
export function resolveQuery(
  config: WidgetConfig,
  reportFilters: ReportFilters,
  nowSec: number
): ResolvedQuery {
  const { dateRange, ...rest } = mergeFilters(reportFilters, config.filters)
  const { start, end } = resolveDateRange(dateRange, nowSec)
  return {
    measure: config.query.measure,
    groupBy: config.query.groupBy,
    timeGrain: config.query.timeGrain,
    filters: { ...rest, dateStart: start, dateEnd: end }
  }
}

// ---------- time buckets ----------

export const MAX_BUCKETS = 1000

/** Format a date as the bucket label the SQL layer produces for this grain. */
export function bucketLabelFor(grain: Exclude<TimeGrain, 'none'>, date: Date): string {
  switch (grain) {
    case 'day':
      return format(date, 'yyyy-MM-dd')
    case 'week':
      return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    case 'month':
      return format(date, 'yyyy-MM')
    case 'quarter':
      return `${format(date, 'yyyy')}-Q${getQuarter(date)}`
    case 'year':
      return format(date, 'yyyy')
  }
}

/**
 * All bucket labels between startSec and endSec (inclusive), in local time,
 * matching the SQL label format. Returns null when the range exceeds
 * MAX_BUCKETS (caller should ask for a coarser grain).
 */
export function enumerateBuckets(
  grain: Exclude<TimeGrain, 'none'>,
  startSec: number,
  endSec: number
): string[] | null {
  const add = {
    day: addDays,
    week: addWeeks,
    month: addMonths,
    quarter: addQuarters,
    year: addYears
  }[grain]
  const buckets: string[] = []
  let cursor = new Date(startSec * 1000)
  const endLabel = bucketLabelFor(grain, new Date(endSec * 1000))
  for (;;) {
    const label = bucketLabelFor(grain, cursor)
    buckets.push(label)
    if (label === endLabel) return buckets
    if (buckets.length >= MAX_BUCKETS) return null
    cursor = add(cursor, 1)
  }
}

// ---------- rows & entities ----------

export interface QueryRow {
  /** bucket label per grain, or null when timeGrain = 'none' */
  bucket: string | null
  /** category / group / account id; null = uncategorized/ungrouped or no groupBy */
  groupId: number | null
  groupLabel: string | null
  currency: string
  /** milliunits (plain count for measure = 'count') */
  value: number
}

export interface RunQueryResult {
  rows: QueryRow[]
  /** distinct currencies present — >1 means the widget should warn */
  currencies: string[]
}

export interface Report {
  id: number
  name: string
  filters: ReportFilters
  createdAt: number
  updatedAt: number
}

export interface ReportSummary {
  id: number
  name: string
  widgetCount: number
  updatedAt: number
}

export interface ReportWidget {
  id: number
  reportId: number
  title: string
  type: WidgetType
  /** null when the stored config no longer parses — renderer shows "reconfigure" */
  config: WidgetConfig | null
  x: number
  y: number
  w: number
  h: number
}

export interface ReportDetail {
  report: Report
  widgets: ReportWidget[]
}

// ---------- IPC inputs ----------

const reportNameSchema = z.string().trim().min(1).max(100)
const widgetTitleSchema = z.string().trim().min(1).max(100)

export const widgetLayoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(50)
})

const newWidgetSchema = widgetLayoutSchema.extend({
  title: widgetTitleSchema,
  type: widgetTypeSchema,
  config: widgetConfigSchema
})
export type NewWidget = z.infer<typeof newWidgetSchema>

export const reportCreateSchema = z.object({
  name: reportNameSchema,
  filters: reportFiltersSchema.optional(),
  /** allows creating template reports atomically */
  widgets: z.array(newWidgetSchema).max(50).optional()
})
export type ReportCreateInput = z.infer<typeof reportCreateSchema>

export const reportUpdateSchema = z.object({
  id: idSchema,
  name: reportNameSchema.optional(),
  filters: reportFiltersSchema.optional()
})
export type ReportUpdateInput = z.infer<typeof reportUpdateSchema>

export const widgetCreateSchema = newWidgetSchema.extend({
  reportId: idSchema
})
export type WidgetCreateInput = z.infer<typeof widgetCreateSchema>

export const widgetUpdateSchema = z.object({
  id: idSchema,
  title: widgetTitleSchema.optional(),
  type: widgetTypeSchema.optional(),
  config: widgetConfigSchema.optional()
})
export type WidgetUpdateInput = z.infer<typeof widgetUpdateSchema>

export const widgetLayoutsSchema = z.object({
  reportId: idSchema,
  layouts: z
    .array(widgetLayoutSchema.extend({ id: idSchema }))
    .min(1)
    .max(50)
})
export type WidgetLayoutsInput = z.infer<typeof widgetLayoutsSchema>

export const reportTransactionsQuerySchema = z.object({
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
  sortBy: transactionSortBySchema,
  sortDir: z.enum(['asc', 'desc']),
  filters: resolvedFiltersSchema
})
export type ReportTransactionsQuery = z.infer<typeof reportTransactionsQuerySchema>

export const REPORTS_IPC = {
  list: 'reports:list',
  get: 'reports:get',
  create: 'reports:create',
  update: 'reports:update',
  delete: 'reports:delete',
  widgetCreate: 'reports:widgetCreate',
  widgetUpdate: 'reports:widgetUpdate',
  widgetDelete: 'reports:widgetDelete',
  widgetLayouts: 'reports:widgetLayouts',
  runQuery: 'reports:runQuery',
  transactions: 'reports:transactions'
} as const
