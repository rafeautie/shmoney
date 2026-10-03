import type { Measure, WidgetConfig } from '@shared/reports'
import { formatAmount } from '@/lib/utils'
import type { FormatValue } from '@/components/charts/chart'

export function formatMeasureValue(measure: Measure, value: number, currency: string): string {
  if (measure === 'count') return Math.round(value).toLocaleString()
  return formatAmount(value, currency)
}

/** Compact axis ticks: "$1.2K" for money (milliunits), "1.2K" for counts */
export function tickFormatter(measure: Measure, currency: string): (value: number) => string {
  if (measure === 'count') {
    return (value) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value)
  }
  return (value) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        notation: 'compact'
      }).format(value / 1000)
    } catch {
      return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value / 1000)
    }
  }
}

export function makeFormatValue(measure: Measure, fallbackCurrency: string): FormatValue {
  const compact = tickFormatter(measure, fallbackCurrency)
  return (value, opts) =>
    opts?.compact
      ? compact(value)
      : formatMeasureValue(measure, value, opts?.currency ?? fallbackCurrency)
}

/** 'income' is the formatting token for money with no sign colour, which is how
 * the Goals page shows saved; it spares every formatter below a goal case. */
export function displayMeasure(config: WidgetConfig): Measure {
  return config.query.source === 'goals' ? 'income' : config.query.measure
}
