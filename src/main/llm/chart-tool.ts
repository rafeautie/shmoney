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
 *
 * No description here names a column, not even as an "e.g.". This model copies
 * a literal it can see in preference to reading a value it has to look up, and
 * these three fields are exactly where that hurts: the earlier `e.g.
 * ["spending"]` on series and `here "category"` on group read as defaults, and
 * came back verbatim against results that had aliased something else. A field
 * whose only job is to echo a name from the last result must describe WHERE to
 * read that name, and must not sit next to a plausible answer.
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
        'The label column: the time bucket or group name. Copy it character-for-character from the columns array of your last query result. For stat, repeat the value column here.'
    },
    group: {
      type: ['string', 'null'],
      description:
        "Null, unless your last result has one row per x per group — its columns being the x, a group label, and one measure. Then: the group label column, copied character-for-character from that result's columns array; its values become one line each."
    },
    series: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: MAX_CHART_SERIES,
      description:
        'The numeric value column(s), each copied character-for-character from the columns array of your last query result — never a name from an example, and never a name that query did not alias. Naming several draws one line or bar set each, which is how two measures are compared. With group, exactly the one measure column; pie takes exactly one; stat takes the value column plus optionally a change column.'
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
 * The numeric-series checks every draw needs: each series column must hold
 * numbers, and must not be NULL in every row — that is SUM over no matching
 * rows, and a stat card rendering it reads as "0" when it means "nothing
 * matched".
 */
function seriesProblem(
  columns: string[],
  rows: unknown[][],
  series: string[],
  available: string
): string | null {
  for (const name of series) {
    const index = columns.indexOf(name)
    if (!rows.every((row) => isPlottable(row[index])))
      return `Column "${name}" is not numeric; series columns must be numbers. A label column belongs in x or group, never in series. ${available}`
    if (rows.every((row) => row[index] === null))
      return `Column "${name}" is NULL in every row, meaning no transactions matched the query. Say that instead of charting it.`
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
 * on the column the model *names* in spec.group. Validation is a flat run of
 * guards — the checks every draw needs first, then the per-type ones — and
 * every error is phrased for the model so it can correct the call.
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
    return err(
      'The last query returned no rows, so there is nothing to chart. Tell the user there is no data for that instead.'
    )

  const group = spec.group ?? null
  const available = `The last result's columns are: ${columns.join(', ')}. Call chart again with names copied from that list.`
  const asIs = (): PreparedChart => ({
    ok: true,
    data: { columns, rows },
    series: [...spec.series]
  })

  // every referenced column must exist; stat has no axis, so the x the
  // grammar forces on it is never looked up
  const referenced =
    spec.type === 'stat'
      ? [...spec.series, ...(group === null ? [] : [group])]
      : [...spec.series, ...(group === null ? [] : [group]), spec.x]
  for (const name of referenced)
    if (!columns.includes(name))
      return err(`Column "${name}" is not in the last query result. ${available}`)

  const problem = seriesProblem(columns, rows, spec.series, available)
  if (problem) return err(problem)

  if (group !== null && (spec.type === 'stat' || spec.type === 'pie'))
    return err(
      'group applies to line and bar charts only. Call chart again with group null, or chart this result as a line or bar with group.'
    )

  // stat has no axis: x is ignored (the grammar forces one), rows pass whole
  if (spec.type === 'stat') {
    if (spec.series.length > 2)
      return err('stat takes the value column plus at most one change column.')
    return asIs()
  }

  if (spec.series.includes(spec.x) || group === spec.x)
    return err(
      `Use different columns for x ("${spec.x}"), group and series: x is the label axis, group the label that splits rows into lines, series the measure. Only stat repeats one column in x and series.`
    )

  const xIndex = columns.indexOf(spec.x)
  const xValues = rows.map((row) => row[xIndex])
  const xRepeats = new Set(xValues).size < xValues.length

  if (spec.type === 'pie') {
    if (spec.series.length !== 1) return err('A pie chart takes exactly one series column.')
    if (xRepeats)
      return err(
        `Column "${spec.x}" repeats across rows, so slices would collide. Run a new query returning one row per ${spec.x}, then chart again.`
      )
    return asIs()
  }

  // line/bar with the model's GROUP BY column named: pivot on it, one series
  // per group value, the single series entry being the measure to plot
  if (group !== null) {
    if (spec.series.length !== 1)
      return err('With group, series must be exactly the one measure column to plot per group.')
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
  return asIs()
}

/** a label column of a long-form result, with its distinct-value count */
interface LongFormLabel {
  name: string
  distinct: number
}

/**
 * Recognize the canonical long form — exactly three columns of which exactly
 * one is the numeric measure, both labels repeating, every label pair unique —
 * and nothing looser. Day-number comparisons (two numeric columns) and
 * transaction listings (duplicate pairs) fall through on purpose: a hint that
 * guesses wrong teaches the model a wrong call, which is worse than no hint.
 */
function longFormShape(
  columns: string[],
  rows: unknown[][]
): { labels: [LongFormLabel, LongFormLabel]; measure: string } | null {
  if (columns.length !== 3 || rows.length < 3) return null
  const numericIdx = [0, 1, 2].filter(
    (i) => rows.every((row) => isPlottable(row[i])) && rows.some((row) => row[i] !== null)
  )
  if (numericIdx.length !== 1) return null
  const labelIdx = [0, 1, 2].filter((i) => i !== numericIdx[0])
  const labels = labelIdx.map((i) => ({
    name: columns[i],
    distinct: new Set(rows.map((row) => groupLabel(row[i]))).size
  }))
  // both labels must repeat (else a direct draw already works), and each
  // (label, label) pair must be unique (else this is a listing, not a pivot)
  if (labels.some((label) => label.distinct === rows.length)) return null
  const pairs = new Set(
    rows.map((row) => `${groupLabel(row[labelIdx[0]])} ${groupLabel(row[labelIdx[1]])}`)
  )
  if (pairs.size !== rows.length) return null
  return { labels: [labels[0], labels[1]], measure: columns[numericIdx[0]] }
}

/**
 * The note the worker appends to every successful query result, standing
 * between the rows and the model's next token — the spot where an instruction
 * actually lands on this model. Its job is keeping the model out of
 * prepareChart's error branches instead of recovering through them: it
 * re-names the legal chart columns (they are already under `columns`, but
 * that key sits ahead of up to MAX_ROWS rows of data, and the model reaches
 * for a remembered literal over a name it has to scroll back for), and when
 * the result is unambiguously long-form it states the group recipe — and the
 * series cap where a label column would blow it — before the xRepeats or
 * too-many-groups rejection has to teach the same thing at the cost of a
 * wasted call.
 */
export function chartCallNote(columns: string[], rows: unknown[][]): string {
  const base = `If you chart this result, x, group and series must each be one of these exact names: ${columns.join(', ')}.`
  const shape = longFormShape(columns, rows)
  if (!shape) return base
  const [a, b] = shape.labels
  const capped = shape.labels.filter((label) => label.distinct > MAX_CHART_SERIES)
  return [
    base,
    `It is one row per ${a.name} per ${b.name}: chart it with one of those as x, the other as group, and series just ["${shape.measure}"].`,
    ...capped.map(
      (label) =>
        `"${label.name}" has ${label.distinct} distinct values, over the ${MAX_CHART_SERIES}-series cap, so re-query keeping its top ${MAX_CHART_SERIES} before grouping by it.`
    )
  ].join(' ')
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
