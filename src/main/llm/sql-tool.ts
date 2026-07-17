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
    'CREATE TEMP VIEW transactions AS ' +
      'SELECT id, account_id, posted, amount, description, pending, transacted_at, category_id ' +
      `FROM main.transactions WHERE deleted_at IS NULL${and(`account_id = ${accountId}`)}`,
    'DROP VIEW IF EXISTS temp.accounts',
    'CREATE TEMP VIEW accounts AS ' +
      'SELECT id, name, institution_name, currency, balance, available_balance, balance_date, invert_balance ' +
      `FROM main.accounts${where(`id = ${accountId}`)}`,
    'DROP VIEW IF EXISTS temp.holdings',
    'CREATE TEMP VIEW holdings AS ' +
      'SELECT id, account_id, symbol, description, currency, shares, market_value, cost_basis, purchase_price, created_at ' +
      `FROM main.holdings${where(`account_id = ${accountId}`)}`,
    // never scoped, but always shadowed: strips the encrypted access URL
    'DROP VIEW IF EXISTS temp.connections',
    'CREATE TEMP VIEW connections AS ' +
      'SELECT id, last_synced_at, created_at FROM main.connections'
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
