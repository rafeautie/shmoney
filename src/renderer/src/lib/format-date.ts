import { format } from 'date-fns'

/**
 * Formats a report time-bucket label ('YYYY-MM-DD' / 'YYYY-MM' / 'YYYY-Qn' /
 * 'YYYY') for display. Anything else (e.g. a chat chart's category name on
 * the x-axis) is returned verbatim.
 */
export function formatBucketLabel(label: string): string {
  const day = label.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  if (day) {
    const [, y, m, d] = day
    return format(new Date(Number(y), Number(m) - 1, Number(d)), 'MMM d, yyyy')
  }
  const month = label.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (month) {
    const [, y, m] = month
    return format(new Date(Number(y), Number(m) - 1, 1), 'MMM yyyy')
  }
  const quarter = label.match(/^(\d{4})-Q([1-4])$/)
  if (quarter) {
    const [, y, q] = quarter
    return `Q${q} ${y}`
  }
  if (/^\d{4}$/.test(label)) return label
  return label
}

/** 'YYYY-MM' -> 'MMMM yyyy' (e.g. "February 2026"). Non-matching input returned verbatim. */
export function formatMonthLong(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/)
  if (!match) return month
  const [, y, m] = match
  return format(new Date(Number(y), Number(m) - 1, 1), 'MMMM yyyy')
}
