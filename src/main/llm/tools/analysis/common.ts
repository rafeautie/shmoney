// What every typed tool shares: the context it runs in, the result it returns,
// and the filter builder over the scoped tx view. Tools run SQL over the same
// temp views the query tool reads (scoping, milliunit division, the transfer
// and opening-balance exclusions all come with them), so a typed figure and a
// hand-written query can't disagree about what counts.
import type { AnalysisToolResult, ChartSpec } from '@shared/chat'
import type { DateRange, Window } from './period'
import type { ToolVocab } from './schemas'

/** the subset of better-sqlite3 (worker) and node:sqlite (tests) the tools use */
export interface ToolDb {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
  }
}

/** what update_goal and what_if need to rerun the Goals page's pace math */
export interface GoalPaceInput {
  id: number
  name: string
  /** milliunits, like PaceInput */
  targetAmount: number
  baselineAmount: number
  progress: number
  /** unix seconds */
  startedAt: number
  targetDate: string | null
  currency: string
}

export interface AnalysisContext {
  db: ToolDb
  /** the turn's local date, 'YYYY-MM-DD' */
  today: string
  /** first and last transaction dates in scope; null with no transactions */
  data: DateRange | null
  vocab: ToolVocab
  goalPace: GoalPaceInput[]
}

/** persisted whole on the part; the model reads modelView() of it */
export type AnalysisResult = AnalysisToolResult

export interface ToolOutput {
  result: AnalysisResult
  /** the chart this result draws when the call asked for one */
  chart: ChartSpec | null
}

/** the most rows a result sends the model; the transcript keeps them all */
export const MODEL_ROWS = 20

/**
 * The result as the model reads it: facts first so they're the nearest
 * figures, then at most MODEL_ROWS rows. Keys are snake_case like the rest of
 * the model-facing vocabulary.
 */
export function modelView(result: AnalysisResult): object {
  if (!result.ok) return { ok: false, error: result.error }
  const view: Record<string, unknown> = { ok: true }
  if (result.period) view.period = result.period
  if (result.comparedWith) view.compared_with = result.comparedWith
  if (result.facts && Object.keys(result.facts).length > 0) view.facts = result.facts
  if (result.notes?.length) view.notes = result.notes
  if (result.columns && result.rows) {
    view.columns = result.columns
    view.rows = result.rows.slice(0, MODEL_ROWS)
    if (result.rows.length > MODEL_ROWS) view.rows_shown = `${MODEL_ROWS} of ${result.rows.length}`
  }
  return view
}

/** what a past turn's result replays as: its facts, never its rows */
export function replayView(result: AnalysisResult): object {
  if (!result.ok) return { ok: false, error: result.error }
  return {
    ok: true,
    ...(result.period ? { period: result.period } : {}),
    ...(result.facts ? { facts: result.facts } : {}),
    rows: result.rowCount ?? result.rows?.length ?? 0
  }
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

export function fail(error: string, started: number): ToolOutput {
  return { result: { ok: false, error, durationMs: Date.now() - started }, chart: null }
}

export interface TxFilter {
  window?: Window | null
  category?: string | null
  account?: string | null
  search?: string | null
  currency?: string | null
}

/**
 * A WHERE clause over temp.tx with bound parameters. search matches the
 * description, the normalized merchant and the category, so 'coffee' finds
 * Blue Bottle Coffee and a Coffee category alike.
 */
export function txWhere(f: TxFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (f.window) {
    clauses.push('txn_date BETWEEN ? AND ?')
    params.push(f.window.start, f.window.end)
  }
  if (f.category) {
    clauses.push('category = ?')
    params.push(f.category)
  }
  if (f.account) {
    clauses.push('account_name = ?')
    params.push(f.account)
  }
  const term = f.search?.trim()
  if (term) {
    clauses.push('(description LIKE ? OR merchant LIKE ? OR category LIKE ?)')
    const like = `%${term.replace(/[%_]/g, '')}%`
    params.push(like, like, like)
  }
  if (f.currency) {
    clauses.push('currency = ?')
    params.push(f.currency)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

/** the currencies of the rows a filter matches, the most used first */
export function currenciesOf(ctx: AnalysisContext, f: TxFilter): string[] {
  const where = txWhere(f)
  const rows = ctx.db
    .prepare(
      `SELECT currency, COUNT(*) AS n FROM temp.tx ${where.sql} GROUP BY currency ORDER BY n DESC, currency`
    )
    .all(...where.params) as { currency: string }[]
  return rows.map((r) => r.currency)
}

/** what a result says when it kept to one currency and left the others out */
export function leftOutNote(currency: string, leftOut: string[]): string {
  return `Only ${currency} amounts are counted; ${leftOut.join(', ')} ${leftOut.length === 1 ? 'was' : 'were'} left out, since currencies are never added together.`
}

/**
 * The merchants a search matched, with counts, as a note: makes the scope of
 * 'coffee' or 'amazon' visible, and says so plainly when nothing matched.
 */
export function matchedNote(ctx: AnalysisContext, f: TxFilter): string | null {
  const term = f.search?.trim()
  if (!term) return null
  const where = txWhere(f)
  const rows = ctx.db
    .prepare(
      `SELECT merchant, COUNT(*) AS n FROM temp.tx ${where.sql} GROUP BY merchant ORDER BY n DESC LIMIT 6`
    )
    .all(...where.params) as { merchant: string | null; n: number }[]
  if (rows.length === 0) return `Nothing matched '${term}'.`
  return `'${term}' matched ${rows.map((r) => `${r.merchant ?? '(no description)'} (${r.n})`).join(', ')}.`
}
