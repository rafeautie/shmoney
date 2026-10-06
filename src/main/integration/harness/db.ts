import { expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../demo/db'

// Raw reads over the spec's database, and the invariants every spec must leave
// intact. Raw SQL on purpose: these check the stored truth, not what a handler
// chooses to return.

export type Row = Record<string, unknown>

export function query<T extends Row = Row>(text: string): T[] {
  return db.all<T>(sql.raw(text))
}

export function count(table: string, where = '1'): number {
  return query<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0].n
}

// bookkeeping that undo itself writes, plus preferences, which are never action-logged
const BOOKKEEPING = new Set([
  '__drizzle_migrations',
  'sqlite_sequence',
  'action_log',
  'action_runs',
  'action_log_transactions',
  'llm_usage',
  'settings'
])
const VOLATILE_COLUMNS = new Set(['updated_at'])
// budget fills are keyed by (category, month); a restore may reissue the row id
const SURROGATE_IDS = new Set(['budgets'])

/** every user table's rows, order-independent, minus bookkeeping */
export function snapshot(): Record<string, string[]> {
  const tables = query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  )
    .map((t) => t.name)
    .filter((name) => !BOOKKEEPING.has(name))
  return Object.fromEntries(
    tables.map((table) => [
      table,
      query(`SELECT * FROM "${table}"`)
        .map((row) =>
          JSON.stringify(
            Object.entries(row).filter(
              ([column]) =>
                !VOLATILE_COLUMNS.has(column) && !(column === 'id' && SURROGATE_IDS.has(table))
            )
          )
        )
        .sort()
    ])
  )
}

const MONEY_COLUMNS: [table: string, column: string][] = [
  ['transactions', 'amount'],
  ['accounts', 'balance'],
  ['accounts', 'available_balance'],
  ['holdings', 'market_value'],
  ['holdings', 'cost_basis'],
  ['holdings', 'purchase_price'],
  ['budgets', 'amount'],
  ['savings_goals', 'target_amount'],
  ['savings_goals', 'baseline_amount']
]

export function assertInvariants(): void {
  expect(query('PRAGMA foreign_key_check'), 'dangling foreign keys').toEqual([])
  for (const [table, column] of MONEY_COLUMNS) {
    expect(
      count(table, `${column} IS NOT NULL AND typeof(${column}) != 'integer'`),
      `${table}.${column} holds a non-integer amount`
    ).toBe(0)
  }
  const system = query<{ key: string; n: number }>(
    'SELECT system_key AS key, count(*) AS n FROM categories WHERE system_key IS NOT NULL GROUP BY system_key ORDER BY system_key'
  )
  expect(system, 'one category per system key').toEqual([
    { key: 'income', n: 1 },
    { key: 'opening', n: 1 },
    { key: 'transfers', n: 1 }
  ])
}
