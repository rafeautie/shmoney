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
    group: {
      type: ['string', 'null'],
      description:
        'For a result with one row per x per group (e.g. month, category, spent): the column whose values become the series, here "category". Otherwise null.'
    },
    series: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: MAX_CHART_SERIES,
      description:
        'Numeric value column(s) from your last query result, e.g. ["spending"]. With group, exactly the one measure column; pie takes exactly one; stat takes the value column plus optionally a change column.'
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
 * chart draws: one row per x, one column per group, both in first-appearance
 * row order so the SQL's ORDER BY still governs. A group with no row at some
 * x gets NULL there, which draws as an honest gap rather than a fabricated 0.
 */
function pivot(
  rows: unknown[][],
  xName: string,
  xIndex: number,
  groupIndex: number,
  measureIndex: number
): ChartData {
  const labels: string[] = []
  const xOrder: unknown[] = []
  const cellsByX = new Map<unknown, unknown[]>()
  for (const row of rows) {
    const label = groupLabel(row[groupIndex])
    if (!labels.includes(label)) labels.push(label)
  }
  for (const row of rows) {
    const x = row[xIndex]
    let cells = cellsByX.get(x)
    if (!cells) {
      cells = new Array<unknown>(labels.length).fill(null)
      cellsByX.set(x, cells)
      xOrder.push(x)
    }
    cells[labels.indexOf(groupLabel(row[groupIndex]))] = row[measureIndex]
  }
  return {
    columns: [xName, ...labels],
    rows: xOrder.map((x) => [x, ...cellsByX.get(x)!])
  }
}

/**
 * Resolve a chart call against the turn's most recent successful query result
 * into the exact data to draw. No guessing: a result that is already one
 * column per series passes through whole, and a long-form result (one row per
 * x per group — the shape the model's natural GROUP BY produces) is pivoted
 * on the column the model *names* in spec.group. Errors are phrased for the
 * model so it can correct the call.
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

  const group = spec.group ?? null
  const available = `The last result's columns are: ${columns.join(', ')}.`
  for (const name of [...spec.series, ...(group === null ? [] : [group])])
    if (!columns.includes(name))
      return err(`Column "${name}" is not in the last query result. ${available}`)
  const passthrough = (): PreparedChart =>
    seriesProblem(columns, rows, spec.series, available) ?? {
      ok: true,
      data: { columns, rows },
      series: [...spec.series]
    }

  // stat has no axis: x is ignored (the grammar forces one), rows pass whole
  if (spec.type === 'stat') {
    if (group !== null) return err('group applies to line and bar charts only.')
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

  if (spec.type === 'pie') {
    if (group !== null) return err('group applies to line and bar charts only.')
    if (spec.series.length !== 1) return err('A pie chart takes exactly one series column.')
    if (xRepeats)
      return err(
        `Column "${spec.x}" repeats across rows, so slices would collide. Run a new query returning one row per ${spec.x}, then chart again.`
      )
    return passthrough()
  }

  // line/bar with the model's GROUP BY column named: pivot on it, one series
  // per group value, the single series entry being the measure to plot
  if (group !== null) {
    if (group === spec.x) return err(`Use different columns for x ("${spec.x}") and group.`)
    if (spec.series.length !== 1)
      return err('With group, series must be exactly the one measure column to plot per group.')
    const problem = seriesProblem(columns, rows, spec.series, available)
    if (problem) return problem
    const groupIndex = columns.indexOf(group)
    const labels = new Set(rows.map((row) => groupLabel(row[groupIndex])))
    if (labels.size > MAX_CHART_SERIES)
      return err(
        `"${group}" has ${labels.size} distinct values, more lines than a chart can hold (${MAX_CHART_SERIES}). Run a new query keeping the top ${MAX_CHART_SERIES} groups (ORDER BY the measure and filter or LIMIT), then chart again.`
      )
    const data = pivot(rows, spec.x, xIndex, groupIndex, columns.indexOf(spec.series[0]))
    return { ok: true, data, series: data.columns.slice(1) }
  }

  if (xRepeats)
    return err(
      `Column "${spec.x}" repeats across rows. Either query one row per ${spec.x}, or pass group: the column whose values split the rows into series.`
    )
  return passthrough()
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
