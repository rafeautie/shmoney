import type { QueryToolResult } from '@shared/chat'

// Pure helpers behind the chat `query` tool: SQL validation, the scope-view
// DDL, and result shaping. This module must stay free of better-sqlite3 (and
// any other Electron-bound import) so vitest can load it; the worker owns the
// actual connection.

export const MAX_ROWS = 50
export const MAX_RESULT_CHARS = 4000
/** longer string cells are clipped so one giant description can't eat the char cap */
export const MAX_CELL_CHARS = 300
export const MAX_TOOL_CALLS_PER_TURN = 8

/** what the model may see: null = all accounts */
export interface ChatToolScope {
  accountId: number | null
}

/**
 * Gate model-supplied SQL before it reaches the connection. This is one layer
 * of several (single-statement prepare, stmt.readonly, PRAGMA query_only are
 * the others); its job is a clear early error the model can act on. Errors are
 * phrased for the model, not the user.
 */
export function validateQuerySql(sql: string): { ok: true } | { ok: false; error: string } {
  let rest = sql
  // skip leading whitespace and comments to find the first keyword
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '')
    if (trimmed.startsWith('--')) {
      const eol = trimmed.indexOf('\n')
      if (eol === -1) return { ok: false, error: 'The query is only a comment.' }
      rest = trimmed.slice(eol + 1)
    } else if (trimmed.startsWith('/*')) {
      const close = trimmed.indexOf('*/')
      if (close === -1) return { ok: false, error: 'Unterminated comment.' }
      rest = trimmed.slice(close + 2)
    } else {
      rest = trimmed
      break
    }
  }
  const keyword = /^[a-zA-Z]+/.exec(rest)?.[0].toUpperCase()
  if (keyword !== 'SELECT' && keyword !== 'WITH')
    return {
      ok: false,
      error: 'Only a single read-only SELECT (or WITH ... SELECT) statement is allowed.'
    }
  // unqualified names resolve to the scoped temp views; a schema-qualified
  // main.table would bypass them. (This also rejects the literal text inside
  // strings; if that ever bites, rewrite the query without it.)
  if (/\bmain\s*\./i.test(sql))
    return {
      ok: false,
      error: 'Do not schema-qualify table names (no "main."); use bare table names.'
    }
  return { ok: true }
}

/**
 * DDL run by the worker (under a brief query_only=OFF window) before each
 * turn. The views shadow the real tables for unqualified names: they always
 * hide soft-deleted rows and secret columns, and narrow to one account when
 * the conversation is scoped. View bodies must say main.<table>, otherwise
 * the temp view's own name would resolve circularly.
 *
 * Every money column is divided out of milliunits here, so the model only ever
 * sees real amounts and SUM(amount) is right without it remembering anything.
 * That trades the storage format's exactness for double arithmetic on this
 * surface alone (error lands ~1e-10 on realistic magnitudes, absorbed by the
 * prompt's ROUND(..., 2); the app's own aggregates still read the raw tables).
 * It is the trade the milliunit comment in schema.ts declines for storage, and
 * it's worth taking here: a dropped /1000.0 is a silent 1000x error, and the
 * model dropped them. Divide but never ROUND in the view: amounts are exact to
 * three decimals, and rounding to two would throw the third away.
 */
export function scopeViewsDdl(scope: ChatToolScope): string[] {
  const { accountId } = scope
  // accountId is inlined into DDL (views can't take bound parameters), so it
  // must be a trusted integer, never model- or renderer-supplied text
  if (accountId !== null && !Number.isInteger(accountId))
    throw new Error(`invalid scope accountId: ${String(accountId)}`)
  const and = (clause: string): string => (accountId === null ? '' : ` AND ${clause}`)
  const where = (clause: string): string => (accountId === null ? '' : ` WHERE ${clause}`)
  return [
    'DROP VIEW IF EXISTS temp.transactions',
    // txn_date is exposed as a real column rather than left for the model to
    // rebuild: COALESCE(NULLIF(posted, 0), transacted_at) is on the critical
    // path of nearly every analytical query, and a small model that drops or
    // misspells one piece of it gets a silent wrong answer or a hard error.
    // Dates are handed over as local ISO text (txn_date as 'YYYY-MM-DD', NULL
    // when unknown) rather than as raw epoch integers, because the model
    // compares dates against strings, and an epoch INTEGER compared to date
    // TEXT is always false in SQLite - a silent zero-row result rather than an
    // error.
    // Every name the model reaches for is a real column here: currency and
    // account_name from accounts ("spending per account" grouped by the bare
    // account_id charts as an axis labelled 1, 2, 3), category/category_group/
    // system_key from the category tables. The model treats a name it has seen
    // as a column it can select (it wrote `t.category` against a view without
    // one), so a name it would have to join for is a name it doesn't get.
    // system_key rides along raw — the app's own domain language for system
    // categories ('transfers'), NULL on normal categories — rather than any
    // derived flag; the stored is_transfer flag was retired for exactly that
    // vocabulary.
    'CREATE TEMP VIEW transactions AS ' +
      'SELECT t.id, t.account_id, a.name AS account_name, ' +
      "datetime(NULLIF(t.posted, 0), 'unixepoch', 'localtime') AS posted, " +
      't.amount / 1000.0 AS amount, t.description, t.pending, ' +
      "datetime(NULLIF(t.transacted_at, 0), 'unixepoch', 'localtime') AS transacted_at, " +
      't.category_id, c.name AS category, g.name AS category_group, c.system_key, ' +
      "date(NULLIF(COALESCE(NULLIF(t.posted, 0), t.transacted_at), 0), 'unixepoch', 'localtime') AS txn_date, " +
      'a.currency ' +
      `FROM main.transactions t JOIN main.accounts a ON a.id = t.account_id ` +
      'LEFT JOIN main.categories c ON c.id = t.category_id ' +
      'LEFT JOIN main.category_groups g ON g.id = c.group_id ' +
      `WHERE t.deleted_at IS NULL${and(`t.account_id = ${accountId}`)}`,
    'DROP VIEW IF EXISTS temp.accounts',
    // invert_balance is applied here and the column left out, matching
    // applyInvert in ipc/connections.ts: the flip is a read-time display rule
    // everywhere else in the app, so the model should no more re-derive it
    // than it should re-derive txn_date
    'CREATE TEMP VIEW accounts AS ' +
      'SELECT id, name, institution_name, currency, ' +
      'CASE WHEN invert_balance = 1 THEN -balance ELSE balance END / 1000.0 AS balance, ' +
      'CASE WHEN invert_balance = 1 THEN -available_balance ELSE available_balance END / 1000.0 ' +
      "AS available_balance, datetime(NULLIF(balance_date, 0), 'unixepoch', 'localtime') AS balance_date " +
      `FROM main.accounts${where(`id = ${accountId}`)}`,
    'DROP VIEW IF EXISTS temp.holdings',
    'CREATE TEMP VIEW holdings AS ' +
      'SELECT id, account_id, symbol, description, currency, shares, ' +
      'market_value / 1000.0 AS market_value, cost_basis / 1000.0 AS cost_basis, ' +
      "purchase_price / 1000.0 AS purchase_price, datetime(NULLIF(created_at, 0), 'unixepoch', 'localtime') AS created_at " +
      `FROM main.holdings${where(`account_id = ${accountId}`)}`,
    // never scoped (budgets are per-category), but shadowed so its amount is
    // divided like every other money column; unshadowed, it was the one money
    // table the model still read in raw milliunits. Carries the category name
    // for the same reason transactions does: "how am I doing against my Dining
    // budget" should never need a hand-written join.
    'DROP VIEW IF EXISTS temp.budgets',
    'CREATE TEMP VIEW budgets AS ' +
      'SELECT b.id, b.category_id, c.name AS category, b.month, b.amount / 1000.0 AS amount ' +
      'FROM main.budgets b LEFT JOIN main.categories c ON c.id = b.category_id',
    // never scoped, but always shadowed: strips the encrypted access URL.
    // created_at is already UTC text (current_timestamp default), not an
    // epoch, so it only needs the localtime shift
    'DROP VIEW IF EXISTS temp.connections',
    'CREATE TEMP VIEW connections AS ' +
      "SELECT id, datetime(NULLIF(last_synced_at, 0), 'unixepoch', 'localtime') AS last_synced_at, " +
      "datetime(created_at, 'localtime') AS created_at FROM main.connections",
    // never scoped: rules apply across all accounts. created_at/updated_at are
    // unix seconds, NOT NULL, with no 0 sentinel to guard against
    'DROP VIEW IF EXISTS temp.rules',
    'CREATE TEMP VIEW rules AS ' +
      'SELECT id, name, enabled, priority, conditions, action, ' +
      "datetime(created_at, 'unixepoch', 'localtime') AS created_at, " +
      "datetime(updated_at, 'unixepoch', 'localtime') AS updated_at FROM main.rules",
    // never scoped: history spans every account. created_at/undone_at are unix
    // MILLISECONDS (see the actionLog comment in schema.ts), so they're divided
    // before the epoch conversion; changes is left out on purpose, it's huge
    // and internal
    'DROP VIEW IF EXISTS temp.action_log',
    'CREATE TEMP VIEW action_log AS ' +
      "SELECT id, datetime(created_at / 1000, 'unixepoch', 'localtime') AS created_at, " +
      "source, label, datetime(undone_at / 1000, 'unixepoch', 'localtime') AS undone_at " +
      'FROM main.action_log'
  ]
}

/**
 * Cap a query's rows to what fits the model's context: the row cap first
 * (pass up to MAX_ROWS + 1 rows in so truncation is detectable), then clip
 * oversized cells, then drop whole rows until the serialized size fits.
 */
export function shapeResult(
  columns: string[],
  rows: unknown[][],
  durationMs: number
): QueryToolResult {
  let truncated = rows.length > MAX_ROWS
  const kept = rows.slice(0, MAX_ROWS).map((row) =>
    row.map((cell) => {
      if (typeof cell !== 'string' || cell.length <= MAX_CELL_CHARS) return cell
      truncated = true
      return cell.slice(0, MAX_CELL_CHARS) + '…'
    })
  )
  const size = (): number => JSON.stringify({ columns, rows: kept }).length
  while (kept.length > 0 && size() > MAX_RESULT_CHARS) {
    kept.pop()
    truncated = true
  }
  return { ok: true, columns, rows: kept, rowCount: kept.length, truncated, durationMs }
}
