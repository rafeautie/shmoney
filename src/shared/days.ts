const NO_DATE = 'none'

/** The local calendar day a row is grouped under, as yyyy-MM-dd; runs per row per load, so no date-fns */
export function dayKey(date: number): string {
  if (!date) return NO_DATE
  const d = new Date(date * 1000)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function isNoDate(key: string): boolean {
  return key === NO_DATE
}
