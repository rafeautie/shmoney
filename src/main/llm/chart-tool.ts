import { CHART_TYPES, type ChartData, type ChartSpec, type QueryToolResult } from '@shared/chat'

// Pure helpers behind the chat `chart` tool: the params schema (which
// grammar-constrains decoding, so a generated call is structurally valid by
// construction) and the spec-to-drawable preparation. Like sql-tool.ts, this
// module must stay free of Electron-bound imports so vitest can load it.

/**
 * More series than this stops reading as a chart; the grammar enforces the cap
 * on generated series, and the pivot enforces it on discovered groups. Sized
 * for "one line per category" comparisons — beyond this many lines a chart is
 * unreadable anyway.
 */
export const MAX_CHART_SERIES = 8

/**
 * Params schema for defineChatSessionFunction. Every property is generated
 * (the grammar treats them all as required), so `x` exists even for stat,
 * where validation ignores it. Descriptions are the model's main
 * documentation for each field; the exemplars live in the system prompt.
 */
export const CHART_FUNCTION_PARAMS = {
  type: 'object',
  properties: {
    type: {
      enum: [...CHART_TYPES],
      description:
        'line for a trend over time buckets, bar for a comparison across groups, pie for shares of a whole, stat for one headline number.'
    },
    title: {
      type: 'string',
      description: 'A short title for the chart, e.g. "Spending by month".'
    },
    x: {
      type: 'string',
      description:
        'The label column from your last query result: the time bucket or group name. For stat, repeat the value column.'
    },
    series: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: MAX_CHART_SERIES,
      description:
        'Numeric value column(s) from your last query result, e.g. ["spending"]. pie takes exactly one; stat takes the value column plus optionally a change column.'
    }
  }
} as const

/**
 * What a chart call resolved to: the exact rows to draw plus the series
 * labels to draw them under (which differ from spec.series when a long-form
 * result was pivoted into one line per group), or an error phrased for the
 * model. Never throws.
 */
export type PreparedChart =
  { ok: true; data: ChartData; series: string[] } | { ok: false; error: string }

/** a cell a chart can plot: SQLite numbers, or NULL for a missing point */
function isPlottable(cell: unknown): boolean {
  return cell === null || typeof cell === 'number' || typeof cell === 'bigint'
}

const err = (error: string): PreparedChart => ({ ok: false, error })

/** a group value as a line label; NULL groups are real (uncategorized rows) */
const groupLabel = (cell: unknown): string => (cell === null ? '(none)' : String(cell))

/**
 * The numeric-series checks shared by every direct (unpivoted) draw: each
 * series column must hold numbers, and must not be NULL in every row — that
 * is SUM over no matching rows, and a stat card rendering it reads as "0"
 * when it means "nothing matched".
 */
function seriesProblem(
  columns: string[],
  rows: unknown[][],
  series: string[],
  available: string
): PreparedChart | null {
  for (const name of series) {
    const index = columns.indexOf(name)
    if (!rows.every((row) => isPlottable(row[index])))
      return err(`Column "${name}" is not numeric; series columns must be numbers. ${available}`)
    if (rows.every((row) => row[index] === null))
      return err(
        `Column "${name}" is NULL in every row, meaning no transactions matched the query. Say that instead of charting it.`
      )
  }
  return null
}

/**
 * Reshape a long-form result (one row per x per group) into the wide form a
 * chart draws: one row per x, one column per group, in first-appearance row
 * order so the SQL's ORDER BY still governs. A group with no row at some x
 * gets NULL there, which draws as an honest gap rather than a fabricated 0.
 */
function pivot(
  rows: unknown[][],
  xName: string,
  xIndex: number,
  groupIndex: number,
  measureIndex: number,
  groups: unknown[]
): ChartData {
  const labels = groups.map(groupLabel)
  const xOrder: unknown[] = []
  const cellsByX = new Map<unknown, unknown[]>()
  for (const row of rows) {
    const x = row[xIndex]
    let cells = cellsByX.get(x)
    if (!cells) {
      cells = new Array<unknown>(groups.length).fill(null)
      cellsByX.set(x, cells)
      xOrder.push(x)
    }
    const group = labels.indexOf(groupLabel(row[groupIndex]))
    if (group !== -1) cells[group] = row[measureIndex]
  }
  return {
    columns: [xName, ...labels],
    rows: xOrder.map((x) => [x, ...cellsByX.get(x)!])
  }
}

/**
 * Resolve a chart call against the turn's most recent successful query result
 * into the exact data to draw. A wide result (unique x, series naming numeric
 * columns) passes through whole. A long-form result — the shape the model's
 * natural GROUP BY produces — is pivoted here, in code, rather than bounced
 * back for the model to reshape in SQL; it arrives in two spellings:
 *
 * - series name the VALUES of a group column ({x: day, series: ["2026-06",
 *   "2026-07"]} over day/month/spending): each requested value becomes a line.
 * - series name the one measure with x repeating ({x: day, series:
 *   ["spending"]}): the single label column's distinct values become lines.
 *
 * Errors are phrased for the model so it can correct the call.
 */
export function prepareChart(
  spec: ChartSpec,
  lastResult: Pick<QueryToolResult, 'columns' | 'rows'> | null
): PreparedChart {
  if (!lastResult?.columns || !lastResult.rows)
    return err(
      'No query has run in this reply yet; results from earlier replies expire. Run the query now, then call chart again.'
    )
  const { columns, rows } = lastResult
  if (rows.length === 0)
    return err('The last query returned no rows, so there is nothing to chart.')

  const available = `The last result's columns are: ${columns.join(', ')}.`
  const passthrough = (): PreparedChart =>
    seriesProblem(columns, rows, spec.series, available) ?? {
      ok: true,
      data: { columns, rows },
      series: [...spec.series]
    }

  // stat has no axis: x is ignored (the grammar forces one), rows pass whole
  if (spec.type === 'stat') {
    const missing = spec.series.find((s) => !columns.includes(s))
    if (missing !== undefined)
      return err(`Column "${missing}" is not in the last query result. ${available}`)
    if (spec.series.length > 2)
      return err('stat takes the value column plus at most one change column.')
    return passthrough()
  }

  if (!columns.includes(spec.x))
    return err(`Column "${spec.x}" is not in the last query result. ${available}`)
  if (spec.series.includes(spec.x))
    return err(`Use different columns for x ("${spec.x}") and series.`)

  const xIndex = columns.indexOf(spec.x)
  const xValues = rows.map((row) => row[xIndex])
  const xRepeats = new Set(xValues).size < xValues.length
  const missing = spec.series.filter((s) => !columns.includes(s))

  if (spec.type === 'pie') {
    if (spec.series.length !== 1) return err('A pie chart takes exactly one series column.')
    if (missing.length > 0)
      return err(`Column "${missing[0]}" is not in the last query result. ${available}`)
    if (xRepeats)
      return err(
        `Column "${spec.x}" repeats across rows, so slices would collide. Run a new query returning one row per ${spec.x}, then chart again.`
      )
    return passthrough()
  }

  // line/bar with a wide result: draw it as asked
  if (missing.length === 0 && !xRepeats) return passthrough()

  // series naming VALUES of a group column: the model asked for one line per
  // group by naming the groups. Find the column those values live in (compared
  // as labels, so a numeric group column still matches) and pivot on it.
  if (missing.length === spec.series.length) {
    const groupIndex = columns.findIndex((_, i) =>
      missing.every((m) => rows.some((row) => groupLabel(row[i]) === m))
    )
    if (groupIndex === -1)
      return err(`Column "${missing[0]}" is not in the last query result. ${available}`)
    const measures = columns.filter((_, i) => i !== xIndex && i !== groupIndex)
    if (measures.length !== 1)
      return err(
        `Series ${missing.map((m) => `"${m}"`).join(', ')} are values of the "${columns[groupIndex]}" column, and the result carries ${measures.length === 0 ? 'no' : 'several'} other columns (${measures.join(', ') || 'none'}), so there is no single value column to plot. Query one row per ${spec.x} per ${columns[groupIndex]} with exactly one measure, then chart again.`
      )
    const measureIndex = columns.indexOf(measures[0])
    const problem = seriesProblem(columns, rows, measures, available)
    if (problem) return problem
    return {
      ok: true,
      data: pivot(rows, spec.x, xIndex, groupIndex, measureIndex, [...spec.series]),
      series: [...spec.series]
    }
  }
  if (missing.length > 0)
    return err(`Column "${missing[0]}" is not in the last query result. ${available}`)

  // x repeats under a single measure: one row per x per group. Split into one
  // line per distinct value of the group column, if there is exactly one.
  if (spec.series.length > 1)
    return err(
      `Column "${spec.x}" repeats across rows, and with several series there is no single way to split them into lines. Query one row per ${spec.x} per group with one measure, then chart with that measure as the only series.`
    )
  const measureIndex = columns.indexOf(spec.series[0])
  const candidates = columns
    .map((name, i) => ({ name, i }))
    .filter(
      ({ i }) =>
        i !== xIndex && i !== measureIndex && rows.some((row) => typeof row[i] === 'string')
    )
  if (candidates.length === 0)
    return err(
      `Column "${spec.x}" repeats across rows, but no other column groups them. Run a new query returning one row per ${spec.x}, then chart again.`
    )
  if (candidates.length > 1)
    return err(
      `Column "${spec.x}" repeats across rows, and ${candidates.map((c) => `"${c.name}"`).join(' and ')} could each be the group. Keep one group column beside ${spec.x} and query again.`
    )
  const groupIndex = candidates[0].i
  const groups: unknown[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const label = groupLabel(row[groupIndex])
    if (!seen.has(label)) {
      seen.add(label)
      groups.push(row[groupIndex])
    }
  }
  if (groups.length > MAX_CHART_SERIES)
    return err(
      `"${candidates[0].name}" has ${groups.length} distinct values, more lines than a chart can hold (${MAX_CHART_SERIES}). Run a new query keeping the top ${MAX_CHART_SERIES} groups (ORDER BY the measure and filter or LIMIT), then chart again.`
    )
  const problem = seriesProblem(columns, rows, spec.series, available)
  if (problem) return problem
  return {
    ok: true,
    data: pivot(rows, spec.x, xIndex, groupIndex, measureIndex, groups),
    series: groups.map(groupLabel)
  }
}

/**
 * The one currency amounts format as, when the turn's scope makes it
 * unambiguous: every account in scope shares it. Mixed (or no) currencies
 * return null and chart values render as plain numbers — a deliberate
 * data-layer rule, never the model's job.
 */
export function resolveCurrency(accounts: { currency: string }[]): string | null {
  const first = accounts[0]?.currency
  if (!first) return null
  return accounts.every((a) => a.currency === first) ? first : null
}
