// Periods as words, resolved in one place so every tool shares their meaning:
// last_N_months is N complete months, this_month is the month so far, and a
// comparison against an unfinished period lines up the same number of days.
// Pure date arithmetic on 'YYYY-MM-DD' strings; no db, no local-time parsing.

export interface DateRange {
  /** 'YYYY-MM-DD' first and last transaction dates in scope */
  min: string
  max: string
}

export interface Window {
  /** inclusive 'YYYY-MM-DD' bounds */
  start: string
  end: string
  /** how the result names it: '2026-07', '2026-06 to 2026-08', '2026 so far' */
  label: string
  /** true when the window runs into the month in progress */
  partial: boolean
}

export type PeriodResult = { ok: true; window: Window } | { ok: false; error: string }

const pad = (n: number): string => String(n).padStart(2, '0')

export function ymd(y: number, m: number, d: number): string {
  // Date.UTC normalizes overflowing months and days, and never shifts by zone
  const date = new Date(Date.UTC(y, m - 1, d))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day)
  return ymd(y, m, d + n)
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

export function monthOfDay(day: string): string {
  return day.slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return ymd(y, m + delta, 1).slice(0, 7)
}

export function monthStart(month: string): string {
  return `${month}-01`
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return ymd(y, m + 1, 0)
}

/** every 'YYYY-MM' from the month of start through the month of end */
export function monthsIn(start: string, end: string): string[] {
  const months: string[] = []
  for (let m = monthOfDay(start); m <= monthOfDay(end); m = shiftMonth(m, 1)) months.push(m)
  return months
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]

function range(start: string, end: string, label: string, today: string): Window {
  const clipped = end > today ? today : end
  return { start, end: clipped, label, partial: clipped >= monthStart(monthOfDay(today)) }
}

function monthWindow(month: string, today: string): Window {
  const w = range(monthStart(month), monthEnd(month), month, today)
  return w.partial ? { ...w, label: `${month} so far` } : w
}

/** the month named by a bare month word: the latest one not in the future */
function namedMonth(index: number, year: number | null, today: string): string {
  const [ty, tm] = parts(today)
  const y = year ?? (index + 1 > tm ? ty - 1 : ty)
  return `${y}-${pad(index + 1)}`
}

/**
 * Resolve one period word into dates. Tolerant of the spellings a small model
 * reaches for ('last 3 months', 'past_3_months', 'ytd', 'July 2026'), and
 * strict about meaning. An unknown form fails with the accepted forms, phrased
 * for the model to retry.
 */
export function resolvePeriod(spec: string, today: string, data: DateRange | null): PeriodResult {
  const r = resolveSpec(spec, today, data)
  // range() clips to today, so a future period would come out as start > end
  // and total a silent 0
  if (r.ok && r.window.start > today) {
    const name = r.window.label.replace(/ so far$/, '')
    return {
      ok: false,
      error: `${name} hasn't started yet; ${data ? `the data runs to ${data.max}` : `today is ${today}`}.`
    }
  }
  return r
}

function resolveSpec(spec: string, today: string, data: DateRange | null): PeriodResult {
  const raw = spec.trim().toLowerCase()
  const s = raw.replace(/[\s-]+/g, '_')
  const current = monthOfDay(today)
  const [ty] = parts(today)

  if (s === 'this_month' || s === 'current_month' || s === 'month_to_date' || s === 'mtd')
    return { ok: true, window: monthWindow(current, today) }
  if (s === 'last_month' || s === 'previous_month' || s === 'prior_month')
    return { ok: true, window: monthWindow(shiftMonth(current, -1), today) }
  const lastN = /^(?:last|past|previous|prior)_(\d{1,2})_months?$/.exec(s)
  if (lastN) {
    const n = Number(lastN[1])
    if (n < 1 || n > 60) return { ok: false, error: `Use between 1 and 60 months, not ${n}.` }
    const first = shiftMonth(current, -n)
    const last = shiftMonth(current, -1)
    return {
      ok: true,
      window: range(
        monthStart(first),
        monthEnd(last),
        n === 1 ? last : `${first} to ${last} (${n} complete months)`,
        today
      )
    }
  }
  if (s === 'this_year' || s === 'ytd' || s === 'year_to_date' || s === 'current_year')
    return { ok: true, window: range(`${ty}-01-01`, `${ty}-12-31`, `${ty} so far`, today) }
  if (s === 'last_year' || s === 'previous_year' || s === 'prior_year')
    return { ok: true, window: range(`${ty - 1}-01-01`, `${ty - 1}-12-31`, `${ty - 1}`, today) }
  if (s === 'all' || s === 'all_time' || s === 'ever') {
    const start = data?.min ?? today
    const end = data?.max ?? today
    return { ok: true, window: { ...range(start, end, 'all time', today), label: 'all time' } }
  }

  const month = /^(\d{4})_(\d{1,2})$/.exec(s)
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12)
    return { ok: true, window: monthWindow(`${month[1]}-${pad(Number(month[2]))}`, today) }
  const yearFirst = /^(\d{4})_?q([1-4])$/.exec(s)
  const quarterFirst = /^q([1-4])_?(\d{4})$/.exec(s)
  if (yearFirst || quarterFirst) {
    const y = Number(yearFirst ? yearFirst[1] : quarterFirst![2])
    const q = Number(yearFirst ? yearFirst[2] : quarterFirst![1])
    const first = `${y}-${pad(q * 3 - 2)}`
    const w = range(monthStart(first), monthEnd(shiftMonth(first, 2)), `${y}-Q${q}`, today)
    return { ok: true, window: w.partial ? { ...w, label: `${y}-Q${q} so far` } : w }
  }
  const year = /^(\d{4})$/.exec(s)
  if (year) {
    const y = Number(year[1])
    const w = range(`${y}-01-01`, `${y}-12-31`, `${y}`, today)
    return { ok: true, window: w.partial ? { ...w, label: `${y} so far` } : w }
  }
  const named = /^([a-z]+)(?:_(\d{4}))?$/.exec(s)
  if (named) {
    const index = MONTH_NAMES.findIndex((n) => n === named[1] || n.slice(0, 3) === named[1])
    if (index >= 0)
      return {
        ok: true,
        window: monthWindow(namedMonth(index, named[2] ? Number(named[2]) : null, today), today)
      }
  }
  return {
    ok: false,
    error: `Unknown period '${spec}'. Use this_month, last_month, last_3_months, last_6_months, last_12_months, this_year, last_year, all, or '2026-07', '2026-Q2' or '2025'.`
  }
}

/**
 * The window a comparison runs over. 'previous' is the same length just
 * before; 'last_year' the same dates a year earlier; anything else is a period
 * of its own. When the base window runs into the month in progress and the
 * comparison spans as many calendar months, the comparison is cut to the same
 * number of days, so a partial month is never set against a whole one; `whole`
 * keeps the uncut window for context. A comparison of a different length is
 * left whole, and totals sets per-month averages side by side instead.
 */
export function resolveComparison(
  spec: string,
  base: Window,
  today: string,
  data: DateRange | null
): { ok: true; window: Window; whole: Window | null } | { ok: false; error: string } {
  const s = spec
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  let whole: Window
  let ownPeriod = false
  if (s === 'previous' || s === 'previous_period' || s === 'prior' || s === 'prior_period') {
    whole = previousOf(base)
  } else if (s === 'last_year' || s === 'same_period_last_year' || s === 'a_year_ago') {
    const [sy, sm, sd] = parts(base.start)
    const start = ymd(sy - 1, sm, sd)
    const fullEnd = previousYearEnd(base)
    whole = { start, end: fullEnd, label: yearEarlierLabel(base), partial: false }
  } else {
    const r = resolvePeriod(spec, today, data)
    if (!r.ok) return r
    whole = r.window
    ownPeriod = true
  }
  if (!base.partial) return { ok: true, window: whole, whole: null }
  const calendarMonths = (w: Window): number => monthsIn(w.start, fullEndOf(w)).length
  if (ownPeriod && calendarMonths(base) !== calendarMonths(whole))
    return { ok: true, window: whole, whole: null }
  const span = daysBetween(base.start, base.end)
  const end = addDays(whole.start, span)
  if (end >= whole.end) return { ok: true, window: whole, whole: null }
  const window: Window = {
    start: whole.start,
    end,
    label: `${whole.label.replace(/ so far$/, '')} through ${end.slice(5)}`,
    partial: false
  }
  return { ok: true, window, whole }
}

/** the base window's full calendar length, before the in-progress clip */
function fullEndOf(base: Window): string {
  if (/^\d{4}-\d{2}( so far)?$/.test(base.label)) return monthEnd(monthOfDay(base.start))
  if (/^\d{4}-Q[1-4]( so far)?$/.test(base.label))
    return monthEnd(shiftMonth(monthOfDay(base.start), 2))
  if (/^\d{4}( so far)?$/.test(base.label)) return `${base.start.slice(0, 4)}-12-31`
  return base.end
}

function previousOf(base: Window): Window {
  const fullEnd = fullEndOf(base)
  const startMonth = monthOfDay(base.start)
  // whole calendar months: step back by the same number of months
  if (base.start.endsWith('-01') && fullEnd === monthEnd(monthOfDay(fullEnd))) {
    const count = monthsIn(base.start, fullEnd).length
    const first = shiftMonth(startMonth, -count)
    const last = shiftMonth(startMonth, -1)
    const label =
      count === 1
        ? first
        : count === 12 && first.endsWith('-01')
          ? first.slice(0, 4)
          : count === 3 && ['01', '04', '07', '10'].includes(first.slice(5))
            ? `${first.slice(0, 4)}-Q${(Number(first.slice(5)) + 2) / 3}`
            : `${first} to ${last}`
    return { start: monthStart(first), end: monthEnd(last), label, partial: false }
  }
  const span = daysBetween(base.start, base.end)
  const end = addDays(base.start, -1)
  const start = addDays(end, -span)
  return { start, end, label: `${start} to ${end}`, partial: false }
}

function previousYearEnd(base: Window): string {
  const [ey, em, ed] = parts(fullEndOf(base))
  return ymd(ey - 1, em, ed)
}

function yearEarlierLabel(base: Window): string {
  const clean = base.label.replace(/ so far$/, '')
  const m = /^(\d{4})(.*)$/.exec(clean)
  if (m && /^(-\d{2}|-Q[1-4])?$/.test(m[2])) return `${Number(m[1]) - 1}${m[2]}`
  const [sy, sm, sd] = parts(base.start)
  const [ey, em, ed] = parts(previousYearEnd(base))
  return `${ymd(sy - 1, sm, sd)} to ${ymd(ey, em, ed)}`
}

/**
 * The months inside a window that are whole and fully covered by data: the
 * ones averages and "typical" figures divide by. The month in progress and a
 * month the data starts partway through never count.
 */
export function completeMonths(window: Window, today: string, data: DateRange | null): string[] {
  if (!data) return []
  const current = monthOfDay(today)
  return monthsIn(window.start, window.end).filter(
    (m) =>
      m < current &&
      monthStart(m) >= window.start &&
      monthEnd(m) <= window.end &&
      monthStart(m) >= firstWholeDataDay(data) &&
      (m < monthOfDay(data.max) || monthEnd(m) <= data.max)
  )
}

/** the first day from which data covers whole months */
function firstWholeDataDay(data: DateRange): string {
  return data.min.endsWith('-01') ? data.min : monthStart(shiftMonth(monthOfDay(data.min), 1))
}

/**
 * What a result should say about the data's edges for this window: nothing
 * when the data covers it, otherwise the range it does cover.
 */
export function coverageNote(window: Window, data: DateRange | null): string | null {
  if (!data) return 'There are no transactions yet.'
  if (window.end < data.min || window.start > data.max)
    return `No transactions in ${window.label}; the data runs ${data.min} to ${data.max}.`
  if (window.start < data.min && monthOfDay(window.start) !== monthOfDay(data.min))
    return `The data starts ${data.min}, so ${window.label} is only partly covered.`
  return null
}
