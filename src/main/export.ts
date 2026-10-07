import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { backupDatabase, db } from './db'
import type { ExportRow } from './ipc/transactions-page'

// CSV per RFC 4180: CRLF rows, and fields quoted only when they must be
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvField).join(',') + '\r\n').join('')
}

// a description a bank (or an import) supplied must never run as a formula
// when the file opens in a spreadsheet
const defuse = (text: string): string => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// tells Excel the file is UTF-8
const BOM = String.fromCharCode(0xfeff)

// amounts are stored as integer milliunits; three places only when needed
const decimal = (milliunits: number): string =>
  (milliunits / 1000).toFixed(milliunits % 10 === 0 ? 2 : 3)

/** the transactions view as a spreadsheet: readable dates, decimal amounts */
export function transactionsCsv(rows: ExportRow[]): string {
  const lines: unknown[][] = [
    ['Date', 'Account', 'Description', 'Category', 'Amount', 'Currency', 'Pending']
  ]
  for (const row of rows) {
    lines.push([
      row.date > 0 ? localDate(new Date(row.date * 1000)) : '',
      defuse(row.accountName),
      defuse(row.description),
      row.categoryName === null ? '' : defuse(row.categoryName),
      decimal(row.amount),
      row.currency,
      row.pending ? 'yes' : 'no'
    ])
  }
  return BOM + toCsv(lines)
}

// migration bookkeeping, not data anyone would want back
const SKIPPED_TABLES = new Set(['__drizzle_migrations'])

function freshFolder(parent: string, base: string): string {
  for (let n = 1; ; n++) {
    const dir = path.join(parent, n === 1 ? base : `${base} (${n})`)
    if (!fs.existsSync(dir)) return dir
  }
}

/** every table as raw CSV plus a copy of the database, in a new folder under `parent` */
export async function exportEverything(parent: string): Promise<string> {
  const dir = freshFolder(parent, `shmoney export ${localDate(new Date())}`)
  fs.mkdirSync(dir, { recursive: true })
  const tables = db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' ORDER BY name`
    )
    .filter((t) => !SKIPPED_TABLES.has(t.name))
  for (const { name } of tables) {
    const columns = db
      .all<{ name: string }>(sql`SELECT name FROM pragma_table_info(${name})`)
      .map((c) => c.name)
    const rows = db.all<Record<string, unknown>>(
      sql.raw(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${name}"`)
    )
    fs.writeFileSync(
      path.join(dir, `${name}.csv`),
      toCsv([columns, ...rows.map((row) => columns.map((c) => row[c]))])
    )
  }
  await backupDatabase(path.join(dir, 'shmoney.db'))
  return dir
}
