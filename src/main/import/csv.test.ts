import { describe, it, expect } from 'vitest'
import { parseCsv, detectCsvMapping, inferDateFormat, parseMoney, normalizeCsvRows } from './csv'
import type { CsvMapping } from '@shared/import'

// imported rows anchor calendar dates at local noon (month is 0-based here)
const noon = (y: number, m0: number, d: number): number => new Date(y, m0, d, 12).getTime() / 1000

describe('parseCsv', () => {
  it('splits headers from rows and auto-detects TSV', () => {
    expect(parseCsv('Date,Amount\n1/1/2024,5.00\n')).toEqual({
      headers: ['Date', 'Amount'],
      rows: [['1/1/2024', '5.00']]
    })
    expect(parseCsv('Date\tAmount\n1/1/2024\t5.00')).toEqual({
      headers: ['Date', 'Amount'],
      rows: [['1/1/2024', '5.00']]
    })
  })

  it('handles quoted fields with embedded commas', () => {
    const { rows } = parseCsv('Date,Description,Amount\n1/1/2024,"ACME, INC",-9.99')
    expect(rows[0][1]).toBe('ACME, INC')
  })
})

describe('parseMoney', () => {
  it('parses plain, symbol, thousands, parens, and suffixed values', () => {
    expect(parseMoney('12.34')).toBe(12340)
    expect(parseMoney('-12.34')).toBe(-12340)
    expect(parseMoney('$1,234.56')).toBe(1234560)
    expect(parseMoney('(12.34)')).toBe(-12340)
    expect(parseMoney('12.34 USD')).toBe(12340)
    expect(parseMoney('USD 12.34')).toBe(12340)
  })

  it('returns null for empty or junk input', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('n/a')).toBeNull()
  })
})

describe('inferDateFormat', () => {
  it('prefers ISO, then US order', () => {
    expect(inferDateFormat(['2024-01-15', '2024-12-31'])).toBe('yyyy-MM-dd')
    expect(inferDateFormat(['1/15/2024', '12/31/2024'])).toBe('M/d/yyyy')
  })

  it('switches to day-first when a value rules out US order', () => {
    expect(inferDateFormat(['15/1/2024', '31/12/2024'])).toBe('d/M/yyyy')
  })

  it('returns null when nothing fits', () => {
    expect(inferDateFormat(['yesterday'])).toBeNull()
  })
})

describe('detectCsvMapping', () => {
  it('detects a single signed amount column', () => {
    const mapping = detectCsvMapping(
      ['Transaction Date', 'Description', 'Amount'],
      [['1/15/2024', 'COFFEE', '-4.50']]
    )
    expect(mapping).toEqual({
      dateColumn: 0,
      dateFormat: 'M/d/yyyy',
      descriptionColumn: 1,
      amount: { kind: 'single', column: 2 }
    })
  })

  it('detects debit/credit columns when there is no amount column', () => {
    const mapping = detectCsvMapping(
      ['Date', 'Payee', 'Debit', 'Credit'],
      [['2024-01-15', 'COFFEE', '4.50', '']]
    )
    expect(mapping?.amount).toEqual({ kind: 'debitCredit', debitColumn: 2, creditColumn: 3 })
  })

  it('returns null when a required column is missing', () => {
    expect(detectCsvMapping(['Foo', 'Bar'], [])).toBeNull()
  })
})

describe('normalizeCsvRows', () => {
  const mapping: CsvMapping = {
    dateColumn: 0,
    dateFormat: 'M/d/yyyy',
    descriptionColumn: 1,
    amount: { kind: 'single', column: 2 }
  }

  it('normalizes rows to unix seconds and milliunits', () => {
    const { rows, errors } = normalizeCsvRows([['1/15/2024', ' COFFEE ', '-4.50']], mapping)
    expect(errors).toEqual([])
    expect(rows).toEqual([{ posted: noon(2024, 0, 15), amount: -4500, description: 'COFFEE' }])
  })

  it('reports unparseable rows with 1-based line numbers and keeps going', () => {
    const { rows, errors } = normalizeCsvRows(
      [
        ['not a date', 'X', '1.00'],
        ['1/2/2024', 'Y', 'oops'],
        ['1/3/2024', 'Z', '2.00']
      ],
      mapping
    )
    expect(rows).toHaveLength(1)
    expect(errors).toEqual([
      { line: 1, message: 'Unparseable date: "not a date"' },
      { line: 2, message: 'Missing or unparseable amount' }
    ])
  })

  it('negates debit magnitudes and passes credits through', () => {
    const dcMapping: CsvMapping = {
      dateColumn: 0,
      dateFormat: 'M/d/yyyy',
      descriptionColumn: 1,
      amount: { kind: 'debitCredit', debitColumn: 2, creditColumn: 3 }
    }
    const { rows } = normalizeCsvRows(
      [
        ['1/1/2024', 'OUT', '4.50', ''],
        ['1/2/2024', 'ALSO OUT', '-4.50', ''],
        ['1/3/2024', 'IN', '', '100.00']
      ],
      dcMapping
    )
    expect(rows.map((r) => r.amount)).toEqual([-4500, -4500, 100000])
  })

  it('picks the nonzero side when the unused debit/credit column is zero-filled', () => {
    const dcMapping: CsvMapping = {
      dateColumn: 0,
      dateFormat: 'M/d/yyyy',
      descriptionColumn: 1,
      amount: { kind: 'debitCredit', debitColumn: 2, creditColumn: 3 }
    }
    const { rows } = normalizeCsvRows(
      [
        ['1/1/2024', 'OUT', '50.00', '0.00'],
        ['1/2/2024', 'IN', '0.00', '100.00']
      ],
      dcMapping
    )
    // a zero-filled unused column must not flatten the real value to 0
    expect(rows.map((r) => r.amount)).toEqual([-50000, 100000])
  })
})
