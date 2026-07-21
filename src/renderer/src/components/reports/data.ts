import { enumerateBuckets, type QueryRow, type TimeGrain } from '@shared/reports'

/** One chart series: a (group, currency) pair. */
export interface SeriesInfo {
  key: string
  groupId: number | null
  label: string
  currency: string
}

export interface TimeSeriesPivot {
  /** one row per bucket: { bucket: '2026-01', 's:12:USD': 123000, ... } */
  data: Record<string, string | number>[]
  series: SeriesInfo[]
  tooManyBuckets: boolean
}

// keys end up in CSS custom property names (--color-<key>), so only [a-zA-Z0-9_-]
export function seriesKey(groupId: number | null, currency: string): string {
  return `s_${groupId ?? 'null'}_${currency.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function seriesLabel(row: QueryRow, multiCurrency: boolean): string {
  const base = row.groupLabel ?? (row.groupId === null ? 'Uncategorized' : `#${row.groupId}`)
  return multiCurrency ? `${base} (${row.currency})` : base
}

/** Parse a SQL bucket label back to a local-time Date (start of the bucket). */
function parseBucketLabel(grain: Exclude<TimeGrain, 'none'>, label: string): Date {
  switch (grain) {
    case 'day':
    case 'week': {
      const [y, m, d] = label.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    case 'month': {
      const [y, m] = label.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    case 'quarter': {
      const [y, q] = label.split('-Q').map(Number)
      return new Date(y, (q - 1) * 3, 1)
    }
    case 'year':
      return new Date(Number(label), 0, 1)
  }
}

function collectSeries(rows: QueryRow[]): SeriesInfo[] {
  const multiCurrency = new Set(rows.map((r) => r.currency)).size > 1
  const series = new Map<string, SeriesInfo>()
  for (const row of rows) {
    const key = seriesKey(row.groupId, row.currency)
    if (!series.has(key)) {
      series.set(key, {
        key,
        groupId: row.groupId,
        label: seriesLabel(row, multiCurrency),
        currency: row.currency
      })
    }
  }
  return [...series.values()]
}

/**
 * Pivot aggregated rows into Recharts-shaped data: one object per time bucket,
 * one numeric field per (group, currency) series. When `zeroFill` is set (all
 * additive measures) missing buckets are filled with 0 so lines/bars don't skip
 * gaps; averages have no natural zero, so their empty buckets are left absent to
 * render as gaps instead of dropping to $0. Cumulative mode runs a per-series
 * running total over the filled data (additive measures only).
 */
export function pivotTimeSeries(
  rows: QueryRow[],
  grain: Exclude<TimeGrain, 'none'>,
  dateStart: number | null,
  dateEnd: number | null,
  cumulative: boolean,
  zeroFill: boolean
): TimeSeriesPivot {
  const series = collectSeries(rows)
  if (rows.length === 0) return { data: [], series, tooManyBuckets: false }

  // for open-ended ranges, span the buckets actually present in the data
  const labels = rows.map((r) => r.bucket!).sort()
  const startSec = dateStart ?? Math.floor(parseBucketLabel(grain, labels[0]).getTime() / 1000)
  const endSec =
    dateEnd ?? Math.floor(parseBucketLabel(grain, labels[labels.length - 1]).getTime() / 1000)

  const buckets = enumerateBuckets(grain, startSec, endSec)
  if (!buckets) return { data: [], series, tooManyBuckets: true }

  const byBucket = new Map<string, Record<string, string | number>>()
  for (const bucket of buckets) {
    const row: Record<string, string | number> = { bucket }
    // averages have no natural zero: leaving empty buckets absent renders them
    // as gaps instead of fabricating a $0 average for a period with no data
    if (zeroFill) for (const s of series) row[s.key] = 0
    byBucket.set(bucket, row)
  }
  for (const row of rows) {
    const target = byBucket.get(row.bucket!)
    // rows outside the enumerated range (clock skew, boundary rounding) are dropped
    if (target) target[seriesKey(row.groupId, row.currency)] = row.value
  }

  const data = [...byBucket.values()]
  // cumulative is a running sum; only meaningful for additive (zero-filled) measures
  if (cumulative && zeroFill) {
    const running = new Map<string, number>()
    for (const row of data) {
      for (const s of series) {
        const next = (running.get(s.key) ?? 0) + (row[s.key] as number)
        running.set(s.key, next)
        row[s.key] = next
      }
    }
  }
  return { data, series, tooManyBuckets: false }
}

export interface GroupTotal {
  groupId: number | null
  label: string
  currency: string
  value: number
}

/**
 * Totals per group for pie / summary-table widgets (timeGrain 'none').
 * Sorting and top-N with an "Other" rollup are applied per currency so
 * different currencies never merge into one slice.
 */
export function groupTotals(
  rows: QueryRow[],
  sort: { by: 'value' | 'label'; dir: 'asc' | 'desc' } | undefined,
  limit: number | undefined
): GroupTotal[] {
  const multiCurrency = new Set(rows.map((r) => r.currency)).size > 1
  const totals: GroupTotal[] = rows.map((row) => ({
    groupId: row.groupId,
    label: seriesLabel(row, multiCurrency),
    currency: row.currency,
    value: row.value
  }))

  const dir = sort?.dir === 'asc' ? 1 : -1
  totals.sort((a, b) => {
    if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1
    if (sort?.by === 'label') return dir * a.label.localeCompare(b.label)
    return dir * (a.value - b.value)
  })

  if (!limit) return totals

  const result: GroupTotal[] = []
  const byCurrency = new Map<string, GroupTotal[]>()
  for (const total of totals) {
    const group = byCurrency.get(total.currency) ?? []
    group.push(total)
    byCurrency.set(total.currency, group)
  }
  for (const [currency, group] of byCurrency) {
    result.push(...group.slice(0, limit))
    const rest = group.slice(limit)
    if (rest.length > 0) {
      result.push({
        groupId: null,
        label: rest.length === 1 ? rest[0].label : 'Other',
        currency,
        value: rest.reduce((sum, t) => sum + t.value, 0)
      })
    }
  }
  return result
}
