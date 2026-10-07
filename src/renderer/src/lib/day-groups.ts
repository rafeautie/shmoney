import { format, isThisYear, isToday, isYesterday } from 'date-fns'
import type { CurrencyTotal } from '@shared/ipc'

const NO_DATE = 'none'

/** The local calendar day a row is grouped under */
export function dayKey(date: number): string {
  return date ? format(new Date(date * 1000), 'yyyy-MM-dd') : NO_DATE
}

export function dayLabel(key: string): string {
  if (key === NO_DATE) return 'No date'
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, isThisYear(date) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')
}

/** Net per currency of the day's rows, plus any of the day still unloaded */
export function dayNet(
  rows: { currency: string; amount: number }[],
  rest: CurrencyTotal[] = []
): CurrencyTotal[] {
  const totals = new Map<string, number>()
  const add = (currency: string, value: number): void => {
    totals.set(currency, (totals.get(currency) ?? 0) + value)
  }
  for (const row of rows) add(row.currency, row.amount)
  for (const part of rest) add(part.currency, part.total)
  return [...totals].map(([currency, total]) => ({ currency, total }))
}
