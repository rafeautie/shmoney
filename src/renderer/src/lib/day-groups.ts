import { format, isThisYear, isToday, isYesterday } from 'date-fns'
import { isNoDate } from '@shared/days'

export function dayLabel(key: string): string {
  if (isNoDate(key)) return 'No date'
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, isThisYear(date) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')
}
