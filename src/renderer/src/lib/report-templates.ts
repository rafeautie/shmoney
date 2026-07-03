import type { DateRange, ReportCreateInput } from '@shared/reports'

const THIS_MONTH: DateRange = { kind: 'relative', unit: 'month', count: 1, includeCurrent: true }
const THIS_YEAR: DateRange = { kind: 'relative', unit: 'year', count: 1, includeCurrent: true }

/** Starter report offered on the empty state and in the New report menu. */
export const SPENDING_OVERVIEW_TEMPLATE: ReportCreateInput = {
  name: 'Spending Overview',
  widgets: [
    {
      title: 'Income this month',
      type: 'stat',
      config: {
        query: { measure: 'income', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: { dateRange: THIS_MONTH } }
      },
      x: 0,
      y: 0,
      w: 4,
      h: 2
    },
    {
      title: 'Expenses this month',
      type: 'stat',
      config: {
        query: { measure: 'expense', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: { dateRange: THIS_MONTH } }
      },
      x: 4,
      y: 0,
      w: 4,
      h: 2
    },
    {
      title: 'Net this month',
      type: 'stat',
      config: {
        query: { measure: 'sum', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: { dateRange: THIS_MONTH } }
      },
      x: 8,
      y: 0,
      w: 4,
      h: 2
    },
    {
      title: 'Monthly expenses by group',
      type: 'bar',
      config: {
        query: {
          measure: 'expense',
          groupBy: 'categoryGroup',
          timeGrain: 'month',
          cumulative: false
        },
        filters: { mode: 'inherit', overrides: {} },
        display: { stacked: true, showLegend: true }
      },
      x: 0,
      y: 2,
      w: 8,
      h: 5
    },
    {
      title: 'Spending by category',
      type: 'pie',
      config: {
        query: {
          measure: 'expense',
          groupBy: 'category',
          timeGrain: 'none',
          cumulative: false,
          limit: 8
        },
        filters: { mode: 'inherit', overrides: { dateRange: THIS_MONTH } },
        display: { donut: true, showLegend: true }
      },
      x: 8,
      y: 2,
      w: 4,
      h: 5
    },
    {
      title: 'Cumulative net this year',
      type: 'line',
      config: {
        query: { measure: 'sum', groupBy: 'none', timeGrain: 'month', cumulative: true },
        filters: { mode: 'inherit', overrides: { dateRange: THIS_YEAR } }
      },
      x: 0,
      y: 7,
      w: 12,
      h: 4
    },
    {
      title: 'Recent transactions',
      type: 'transactions',
      config: {
        query: { measure: 'sum', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: {} }
      },
      x: 0,
      y: 11,
      w: 12,
      h: 6
    }
  ]
}
