import type { ReportCreateInput } from '@shared/reports'

/** Starter report offered on the empty state and in the New report menu. */
export const SPENDING_OVERVIEW_TEMPLATE: ReportCreateInput = {
  name: 'Spending Overview',
  widgets: [
    {
      title: 'Income',
      type: 'stat',
      config: {
        query: { measure: 'income', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: {} }
      },
      x: 0,
      y: 0,
      w: 4,
      h: 2
    },
    {
      title: 'Expenses',
      type: 'stat',
      config: {
        query: { measure: 'expense', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: {} }
      },
      x: 4,
      y: 0,
      w: 4,
      h: 2
    },
    {
      title: 'Net',
      type: 'stat',
      config: {
        query: { measure: 'sum', groupBy: 'none', timeGrain: 'none', cumulative: false },
        filters: { mode: 'inherit', overrides: {} }
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
      type: 'radial',
      config: {
        query: {
          measure: 'expense',
          groupBy: 'category',
          timeGrain: 'none',
          cumulative: false,
          limit: 8
        },
        filters: { mode: 'inherit', overrides: {} },
        display: { showLegend: true }
      },
      x: 8,
      y: 2,
      w: 4,
      h: 5
    },
    {
      title: 'Cumulative net',
      type: 'line',
      config: {
        query: { measure: 'sum', groupBy: 'none', timeGrain: 'month', cumulative: true },
        filters: { mode: 'inherit', overrides: {} }
      },
      x: 0,
      y: 7,
      w: 8,
      h: 4
    },
    {
      title: 'Expenses by category group',
      type: 'radar',
      config: {
        query: {
          measure: 'expense',
          groupBy: 'categoryGroup',
          timeGrain: 'none',
          cumulative: false,
          limit: 8
        },
        filters: { mode: 'inherit', overrides: {} }
      },
      x: 8,
      y: 7,
      w: 4,
      h: 4
    },
    {
      title: 'Relevant transactions',
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
