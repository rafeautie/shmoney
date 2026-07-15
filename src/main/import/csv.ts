import Papa from 'papaparse'
import { parse as parseDate, isValid } from 'date-fns'
import { CSV_DATE_FORMATS, type CsvMapping } from '@shared/import'
import { dayToUnix, type ParsedRow } from './parse'

// Pure CSV normalization: raw table + user-confirmed column mapping -> ParsedRows.
// No electron/db imports so it runs under vitest.

/** first row = headers, rest = data. Papaparse auto-detects the delimiter (covers TSV). */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' })
  const [headers = [], ...rows] = result.data
  return { headers, rows }
}

/** first format that parses every non-empty sample, or null */
export function inferDateFormat(values: string[]): string | null {
  const samples = values.map((v) => v.trim()).filter((v) => v !== '')
  if (samples.length === 0) return null
  for (const format of CSV_DATE_FORMATS) {
    if (samples.every((v) => isValid(parseDate(v, format, new Date())))) return format
  }
  return null
}

/**
 * "$1,234.56" / "(12.34)" / "-12.34" / "12.34 USD" -> integer milliunits.
 * null for empty or unparseable text.
 */
export function parseMoney(text: string): number | null {
  let cleaned = text.trim().replace(/[$€£,\s]|[A-Za-z]{3}$/g, '')
  let negative = false
  const paren = /^\((.*)\)$/.exec(cleaned)
  if (paren) {
    negative = true
    cleaned = paren[1]
  }
  if (cleaned === '') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  const milliunits = Math.round(value * 1000)
  return negative ? -milliunits : milliunits
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase())
  for (const candidate of candidates) {
    const exact = normalized.indexOf(candidate)
    if (exact !== -1) return exact
  }
  for (const candidate of candidates) {
    const partial = normalized.findIndex((h) => h.includes(candidate))
    if (partial !== -1) return partial
  }
  return -1
}

/** best-guess mapping from header names + sample values; null when a role can't be found */
export function detectCsvMapping(headers: string[], rows: string[][]): CsvMapping | null {
  const dateColumn = findColumn(headers, [
    'date',
    'transaction date',
    'posted date',
    'post date',
    'posting date',
    'booking date'
  ])
  const descriptionColumn = findColumn(headers, [
    'description',
    'payee',
    'merchant',
    'name',
    'memo',
    'details',
    'narrative'
  ])
  if (dateColumn === -1 || descriptionColumn === -1) return null

  const dateFormat = inferDateFormat(rows.slice(0, 50).map((r) => r[dateColumn] ?? ''))
  if (!dateFormat) return null

  const amountColumn = findColumn(headers, ['amount'])
  const debitColumn = findColumn(headers, ['debit', 'withdrawal', 'money out'])
  const creditColumn = findColumn(headers, ['credit', 'deposit', 'money in'])
  if (amountColumn !== -1) {
    return {
      dateColumn,
      dateFormat,
      descriptionColumn,
      amount: { kind: 'single', column: amountColumn }
    }
  }
  if (debitColumn !== -1 && creditColumn !== -1) {
    return {
      dateColumn,
      dateFormat,
      descriptionColumn,
      amount: { kind: 'debitCredit', debitColumn, creditColumn }
    }
  }
  return null
}

/** apply a mapping to the raw table; per-row failures land in errors (1-based data-row line) */
export function normalizeCsvRows(
  rows: string[][],
  mapping: CsvMapping
): { rows: ParsedRow[]; errors: { line: number; message: string }[] } {
  const out: ParsedRow[] = []
  const errors: { line: number; message: string }[] = []

  rows.forEach((row, i) => {
    const line = i + 1
    const dateText = (row[mapping.dateColumn] ?? '').trim()
    const parsed = parseDate(dateText, mapping.dateFormat, new Date())
    if (!isValid(parsed)) {
      errors.push({ line, message: `Unparseable date: "${dateText}"` })
      return
    }

    let amount: number | null
    if (mapping.amount.kind === 'single') {
      amount = parseMoney(row[mapping.amount.column] ?? '')
    } else {
      const debit = parseMoney(row[mapping.amount.debitColumn] ?? '')
      const credit = parseMoney(row[mapping.amount.creditColumn] ?? '')
      // debit columns hold magnitudes (money out) regardless of sign convention
      amount = credit !== null ? credit : debit !== null ? -Math.abs(debit) : null
    }
    if (amount === null) {
      errors.push({ line, message: 'Missing or unparseable amount' })
      return
    }

    out.push({
      posted: dayToUnix(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()),
      amount,
      description: (row[mapping.descriptionColumn] ?? '').trim()
    })
  })

  return { rows: out, errors }
}
