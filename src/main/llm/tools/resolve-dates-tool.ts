import type { DateUnit, DateWindowToolResult } from '@shared/chat'

// Pure helper behind the chat `resolve_dates` tool: it turns a relative period
// ("the last 3 months", "the past 90 days", "year to date") into the concrete
// bounds the model then filters on, so the model never does date arithmetic in
// its head — the failure the sql-tool comments document (a wrong literal
// silently returns zero rows, or a partial 'YYYY-MM' BETWEEN drops the last
// month). It is a specific NAMED period, June 2026 or 2026-Q2, that the model
// filters directly without this.
//
// Like sql-tool.ts and calc-tool.ts, this stays free of Electron-bound imports
// so vitest can load it. `today` is passed in as a local 'YYYY-MM-DD' date
// (the worker computes it once per turn, the same value the prompt quotes), so
// the function is pure and deterministic. Calendar arithmetic runs on the
// date's integer parts; day offsets go through Date.UTC, whose days are exactly
// 86_400_000 ms with no DST, and only its UTC components are ever read.

export const DATE_UNITS = [
  'day',
  'week',
  'month',
  'quarter',
  'year'
] as const satisfies readonly DateUnit[]

/**
 * Params schema for defineChatSessionFunction. Every property is generated (the
 * grammar treats them all as required); the descriptions are the model's main
 * documentation for each field.
 */
export const RESOLVE_DATES_PARAMS = {
  type: 'object',
  properties: {
    unit: {
      enum: [...DATE_UNITS],
      description:
        'The size of one period: day, week (7 days), month, quarter or year. For "the last N weeks" use week; there is no "week of the year" here.'
    },
    count: {
      type: 'integer',
      minimum: 1,
      description: 'How many of those periods the window covers, counting back from now.'
    },
    includeCurrent: {
      type: 'boolean',
      description:
        'true ends the window at today, so the current in-progress period is included ("year to date", "the last 3 months up to now"). false gives the most recent COMPLETE periods instead ("last month" is the previous whole month, ending on its last day).'
    }
  }
} as const

interface Ymd {
  y: number
  m: number
  d: number
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
const fmt = ({ y, m, d }: Ymd): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`

function parseDate(iso: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/** the day-count date `delta` days from the given one (delta may be negative) */
function addDays({ y, m, d }: Ymd, delta: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** last calendar day of a month: day 0 of the next month */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** a month ordinal (year*12 + month index) back to its year and 1-based month */
function fromMonthOrdinal(ordinal: number): { y: number; m: number } {
  return { y: Math.floor(ordinal / 12), m: (ordinal % 12) + 1 }
}

/** every 'YYYY-MM' from start's month through end's month, inclusive */
function monthsBetween(start: Ymd, end: Ymd): string[] {
  const months: string[] = []
  for (let ord = start.y * 12 + (start.m - 1); ord <= end.y * 12 + (end.m - 1); ord++) {
    const { y, m } = fromMonthOrdinal(ord)
    months.push(`${pad(y, 4)}-${pad(m)}`)
  }
  return months
}

/**
 * Resolve a relative window into concrete bounds. Never throws: a bad unit or a
 * non-positive count comes back as { ok: false } for the model to correct.
 *
 * day and week are rolling day windows (week = 7 days); month, quarter and year
 * are calendar windows. includeCurrent decides whether the window ends today
 * (the current period counted, partial) or at the end of the last complete
 * period.
 */
export function resolveDateWindow(
  spec: { unit: DateUnit; count: number; includeCurrent: boolean },
  today: string
): DateWindowToolResult {
  const { unit, count, includeCurrent } = spec
  const now = parseDate(today)
  if (!now) return { ok: false, error: `Could not read today's date "${today}".` }
  if (!Number.isInteger(count) || count < 1)
    return { ok: false, error: 'count must be a whole number of at least 1.' }

  let start: Ymd
  let end: Ymd

  if (unit === 'day' || unit === 'week') {
    const span = unit === 'day' ? count : count * 7
    end = includeCurrent ? now : addDays(now, -1)
    start = includeCurrent ? addDays(now, -(span - 1)) : addDays(now, -span)
  } else {
    // calendar units, measured in whole months per period
    const step = unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12
    const currentIndex = Math.floor((now.y * 12 + (now.m - 1)) / step)
    const firstIndex = includeCurrent ? currentIndex - (count - 1) : currentIndex - count
    const firstMonth = fromMonthOrdinal(firstIndex * step)
    start = { y: firstMonth.y, m: firstMonth.m, d: 1 }
    if (includeCurrent) {
      end = now
    } else {
      // last month of the last complete period
      const lastOrdinal = currentIndex * step - 1
      const last = fromMonthOrdinal(lastOrdinal)
      end = { y: last.y, m: last.m, d: lastDayOfMonth(last.y, last.m) }
    }
  }

  return { ok: true, start: fmt(start), end: fmt(end), months: monthsBetween(start, end) }
}
