import { parseSync } from 'ofx-js'
import { deserializeQif } from 'qif-ts'
import { parse as parseDate, isValid } from 'date-fns'

// Pure file-format parsing: text in, rows out. No electron/db imports so these
// run under vitest (better-sqlite3 can't load there — see transfers.test.ts).

/** A file row before dedupe ids are assigned. Units match the app: unix seconds / milliunits. */
export interface ParsedRow {
  posted: number
  amount: number
  description: string
  /** OFX FITID when the format provides one */
  fitid?: string
}

export type ImportFormat = 'ofx' | 'qif' | 'csv'

/** utf-8 first (strict); windows-1252 fallback covers latin-1 bank exports */
export function decodeBuffer(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

export function sniffFormat(fileName: string, text: string): ImportFormat {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'ofx' || ext === 'qfx') return 'ofx'
  if (ext === 'qif') return 'qif'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  const head = text.slice(0, 2000)
  if (head.includes('OFXHEADER') || head.includes('<OFX')) return 'ofx'
  if (/^!(Type|Account|Option)/m.test(head)) return 'qif'
  return 'csv'
}

/** decimal string -> integer milliunits; throws with the offending value */
function toMilliunits(value: string): number {
  const milliunits = Math.round(Number(value) * 1000)
  if (!Number.isFinite(milliunits)) throw new Error(`Unparseable amount: "${value}"`)
  return milliunits
}

/**
 * A file gives a calendar date, not a moment; the app renders `posted` and
 * buckets SQL dates in local time, so anchor the date at local noon — it
 * displays as the file's calendar day in any DST situation.
 */
export function dayToUnix(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 12).getTime() / 1000
}

/** OFX DTPOSTED (YYYYMMDD[HHMMSS[.mmm]][tz]) -> unix seconds (local noon of the date part) */
function ofxDateToUnix(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value)
  if (!m) throw new Error(`Unparseable OFX date: "${value}"`)
  return dayToUnix(Number(m[1]), Number(m[2]), Number(m[3]))
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** OFX 1.x (SGML) and 2.x (XML), including Quicken .qfx. Walks bank + credit-card statements. */
export function parseOfx(text: string): ParsedRow[] {
  const { OFX } = parseSync(text)
  const statements = [
    ...asArray(OFX.BANKMSGSRSV1?.STMTTRNRS).map((r) => r.STMTRS),
    ...asArray(OFX.CREDITCARDMSGSRSV1?.CCSTMTTRNRS).map((r) => r.CCSTMTRS)
  ].filter(Boolean)

  const rows: ParsedRow[] = []
  for (const stmt of statements) {
    for (const t of asArray(stmt.BANKTRANLIST?.STMTTRN)) {
      rows.push({
        posted: ofxDateToUnix(String(t.DTPOSTED)),
        amount: toMilliunits(String(t.TRNAMT)),
        description: String(t.NAME ?? t.PAYEE?.NAME ?? t.MEMO ?? ''),
        fitid: t.FITID !== undefined ? String(t.FITID) : undefined
      })
    }
  }
  return rows
}

// QIF date formats vary by exporter (US vs day-first, 2- vs 4-digit years,
// Quicken's apostrophe years like 12/25'04). Try candidates against every date
// in the file; the first format that parses all of them wins.
// 2-digit-year formats first: 'yy' rejects 4-digit input (trailing chars fail
// the parse) but 'yyyy' silently accepts "04" as year 4, so yy must get first try
const QIF_DATE_FORMATS = ['M/d/yy', 'd/M/yy', 'M/d/yyyy', 'd/M/yyyy', 'yyyy-M-d', 'M-d-yyyy']

function qifDateToUnix(dates: string[]): number[] {
  const cleaned = dates.map((d) => d.trim().replace(/\s+/g, '').replace("'", '/'))
  for (const format of QIF_DATE_FORMATS) {
    const parsed = cleaned.map((d) => parseDate(d, format, new Date()))
    if (parsed.every(isValid)) {
      return parsed.map((d) => dayToUnix(d.getFullYear(), d.getMonth() + 1, d.getDate()))
    }
  }
  throw new Error(`Unrecognized QIF date format (first date: "${dates[0]}")`)
}

// qif-ts chokes on common real-world QIF: an !Account/!Option preamble before
// the !Type header, U (Quicken amount) lines, comma thousands separators (its
// parseFloat would silently read "1,234.56" as 1), and blank-line record
// separators instead of ^ (Chase exports; qif-ts only emits a record on ^).
// Normalize those away.
function preprocessQif(text: string): string {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^!Type:/.test(l))
  const body = lines
    .slice(start === -1 ? 0 : start)
    .map((l) => (l.trim() === '' ? '^' : l))
    .filter((l) => !l.startsWith('U'))
    .map((l) => (l.startsWith('T') ? l.replace(/,/g, '') : l))
  // flush a final record that lacks its own terminator (^ on empty records is a no-op)
  body.push('^')
  return body.join('\n')
}

export function parseQif(text: string): ParsedRow[] {
  const data = deserializeQif(preprocessQif(text))
  const txns = data.transactions.filter((t) => t.date !== undefined && t.amount !== undefined)
  const dates = qifDateToUnix(txns.map((t) => t.date as string))
  return txns.map((t, i) => ({
    posted: dates[i],
    amount: Math.round((t.amount as number) * 1000),
    description: t.payee ?? t.memo ?? ''
  }))
}
