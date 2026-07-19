import { describe, it, expect } from 'vitest'
import {
  MAX_CELL_CHARS,
  MAX_RESULT_CHARS,
  MAX_ROWS,
  scopeViewsDdl,
  shapeResult,
  validateQuerySql
} from './sql-tool'

describe('validateQuerySql', () => {
  it.each([
    'SELECT 1',
    'select * from transactions',
    '  \n SELECT posted FROM transactions',
    'WITH t AS (SELECT 1 AS n) SELECT n FROM t',
    '-- monthly spend\nSELECT sum(amount) FROM transactions',
    '/* leading block */ SELECT 1'
  ])('accepts %s', (sql) => {
    expect(validateQuerySql(sql)).toEqual({ ok: true })
  })

  it.each([
    'INSERT INTO transactions VALUES (1)',
    'UPDATE transactions SET amount = 0',
    'DELETE FROM transactions',
    'DROP TABLE transactions',
    'PRAGMA query_only = OFF',
    "ATTACH DATABASE 'x.db' AS x",
    'CREATE TEMP VIEW v AS SELECT 1',
    'VACUUM',
    ''
  ])('rejects %s', (sql) => {
    expect(validateQuerySql(sql).ok).toBe(false)
  })

  it('rejects schema-qualified names that would bypass the scope views', () => {
    expect(validateQuerySql('SELECT * FROM main.transactions').ok).toBe(false)
    expect(validateQuerySql('select * from MAIN . accounts').ok).toBe(false)
  })

  it('rejects comment-only and unterminated-comment input', () => {
    expect(validateQuerySql('-- just a comment').ok).toBe(false)
    expect(validateQuerySql('/* never closed').ok).toBe(false)
  })
})

describe('scopeViewsDdl', () => {
  it('always hides soft-deleted rows, without narrowing when unscoped', () => {
    const ddl = scopeViewsDdl({ accountId: null }).join('\n')
    expect(ddl).toContain('WHERE t.deleted_at IS NULL')
    expect(ddl).not.toContain('account_id =')
    expect(ddl).not.toContain('WHERE id =')
  })

  it('narrows transactions, accounts and holdings to the scoped account', () => {
    const ddl = scopeViewsDdl({ accountId: 7 }).join('\n')
    expect(ddl).toContain('WHERE t.deleted_at IS NULL AND t.account_id = 7')
    expect(ddl).toContain('FROM main.accounts WHERE id = 7')
    expect(ddl).toContain('FROM main.holdings WHERE account_id = 7')
  })

  it('never exposes the connection secret, scoped or not', () => {
    for (const scope of [{ accountId: null }, { accountId: 7 }]) {
      const ddl = scopeViewsDdl(scope).join('\n')
      expect(ddl).toContain('FROM main.connections')
      expect(ddl).not.toContain('access_url_encrypted')
    }
  })

  // units, narrowing and soft-delete filtering are asserted by running the
  // views against the real schema; see scope-views.test.ts
  it('drops each view before recreating it', () => {
    const ddl = scopeViewsDdl({ accountId: null })
    for (const name of [
      'transactions',
      'accounts',
      'holdings',
      'budgets',
      'connections',
      'rules',
      'action_log'
    ]) {
      const drop = ddl.findIndex((s) => s === `DROP VIEW IF EXISTS temp.${name}`)
      const create = ddl.findIndex((s) => s.startsWith(`CREATE TEMP VIEW ${name} `))
      expect(drop).toBeGreaterThanOrEqual(0)
      expect(create).toBe(drop + 1)
    }
  })

  it('refuses a non-integer accountId (it is inlined into DDL)', () => {
    expect(() => scopeViewsDdl({ accountId: 7.5 })).toThrow()
    expect(() => scopeViewsDdl({ accountId: NaN })).toThrow()
  })
})

describe('shapeResult', () => {
  it('passes small results through untruncated', () => {
    const result = shapeResult(['id', 'amount'], [[1, -5000]], 3)
    expect(result).toEqual({
      ok: true,
      columns: ['id', 'amount'],
      rows: [[1, -5000]],
      rowCount: 1,
      truncated: false,
      durationMs: 3
    })
  })

  it('caps rows at MAX_ROWS and flags the truncation', () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => [i])
    const result = shapeResult(['n'], rows, 1)
    expect(result.rows).toHaveLength(MAX_ROWS)
    expect(result.rowCount).toBe(MAX_ROWS)
    expect(result.truncated).toBe(true)
  })

  it('clips oversized string cells', () => {
    const result = shapeResult(['description'], [['x'.repeat(MAX_CELL_CHARS + 100)]], 1)
    expect(result.rows?.[0][0]).toBe('x'.repeat(MAX_CELL_CHARS) + '…')
    expect(result.truncated).toBe(true)
  })

  it('drops whole rows until the serialized result fits the char cap', () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i, 'y'.repeat(200)])
    const result = shapeResult(['n', 'text'], rows, 1)
    expect(
      JSON.stringify({ columns: result.columns, rows: result.rows }).length
    ).toBeLessThanOrEqual(MAX_RESULT_CHARS)
    expect(result.rows!.length).toBeLessThan(40)
    expect(result.truncated).toBe(true)
  })

  it('handles empty results', () => {
    const result = shapeResult(['n'], [], 1)
    expect(result).toMatchObject({ ok: true, rows: [], rowCount: 0, truncated: false })
  })
})
