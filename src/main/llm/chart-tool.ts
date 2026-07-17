import {
  CHART_TYPES,
  type ChartSpec,
  type ChartToolResult,
  type QueryToolResult
} from '@shared/chat'

// Pure helpers behind the chat `chart` tool: the params schema (which
// grammar-constrains decoding, so a generated call is structurally valid by
// construction) and the column-reference validation. Like sql-tool.ts, this
// module must stay free of Electron-bound imports so vitest can load it.

/**
 * More series than this stops reading as a chart; the grammar enforces the cap
 * so the model can't generate past it. Sized for "one line per category"
 * comparisons — beyond this many lines a chart is unreadable anyway.
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

/** a cell a chart can plot: SQLite numbers, or NULL for a missing point */
function isPlottable(cell: unknown): boolean {
  return cell === null || typeof cell === 'number' || typeof cell === 'bigint'
}

/**
 * Gate a chart call against the turn's most recent successful query result.
 * Never throws; errors are phrased for the model so it can correct the call
 * (typically a misremembered column alias).
 */
export function validateChartCall(
  spec: ChartSpec,
  lastResult: Pick<QueryToolResult, 'columns' | 'rows'> | null
): ChartToolResult {
  if (!lastResult?.columns || !lastResult.rows)
    return { ok: false, error: 'There is no query result to chart; run query first.' }
  const { columns, rows } = lastResult
  if (rows.length === 0)
    return { ok: false, error: 'The last query returned no rows, so there is nothing to chart.' }

  const available = `The last result's columns are: ${columns.join(', ')}.`
  const missing = spec.series.filter((s) => !columns.includes(s))
  if (missing.length > 0)
    return {
      ok: false,
      error: `Column "${missing[0]}" is not in the last query result. ${available}`
    }
  // stat has no axis, so a repeated/placeholder x is fine there
  if (spec.type !== 'stat') {
    if (!columns.includes(spec.x))
      return {
        ok: false,
        error: `Column "${spec.x}" is not in the last query result. ${available}`
      }
    if (spec.series.includes(spec.x))
      return { ok: false, error: `Use different columns for x ("${spec.x}") and series.` }
    // long-form data (one row per x per group) draws a zigzag; turn it into a
    // corrective error steering the model toward the prompt's pivot recipe
    const xIndex = columns.indexOf(spec.x)
    const seen = new Set<unknown>()
    for (const row of rows) {
      if (seen.has(row[xIndex]))
        return {
          ok: false,
          error: `Column "${spec.x}" repeats across rows, so the lines would tangle. Run a NEW query returning one row per ${spec.x}, with one column per group: SUM(CASE WHEN category LIKE '%Word%' THEN -amount ELSE 0 END) AS alias for each group — the group names are visible in your last result's rows. Then call chart again with those aliases as series.`
        }
      seen.add(row[xIndex])
    }
  }
  if (spec.type === 'pie' && spec.series.length !== 1)
    return { ok: false, error: 'A pie chart takes exactly one series column.' }
  if (spec.type === 'stat' && spec.series.length > 2)
    return { ok: false, error: 'stat takes the value column plus at most one change column.' }

  for (const name of spec.series) {
    const index = columns.indexOf(name)
    if (!rows.every((row) => isPlottable(row[index])))
      return {
        ok: false,
        error: `Column "${name}" is not numeric; series columns must be numbers. ${available}`
      }
  }
  return { ok: true }
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
