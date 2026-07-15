// Pure envelope-rollover math, kept free of db imports so vitest can load it
// (better-sqlite3 is built for Electron's ABI and won't load under vitest).

export interface BudgetFillRow {
  categoryId: number
  month: string
  amount: number
}

export interface EnvelopeComputation {
  categoryId: number
  startMonth: string
  fill: number
  spent: number
  balance: number
}

/** Inclusive 'YYYY-MM' labels from start to end; empty when start > end. */
export function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = []
  let [y, m] = start.split('-').map(Number)
  for (;;) {
    const label = `${y}-${String(m).padStart(2, '0')}`
    if (label > end) break
    out.push(label)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/**
 * The rollover math. For each envelope, walk every month from its first fill
 * row to the viewed month: the effective fill is the latest row at or before
 * that month (sparse rows inherit forward), and the balance accumulates
 * fill − spent — so underspending rolls forward and overspending carries a
 * negative balance. Envelopes whose first row is after the viewed month
 * didn't exist yet and are omitted.
 *
 * `budgetRows` must be sorted by (categoryId, month asc); `spend` is keyed
 * `${categoryId}:${month}` with positive expense magnitudes.
 */
export function computeEnvelopes(
  budgetRows: BudgetFillRow[],
  spend: Map<string, number>,
  viewedMonth: string
): EnvelopeComputation[] {
  const byCategory = new Map<number, BudgetFillRow[]>()
  for (const row of budgetRows) {
    const list = byCategory.get(row.categoryId)
    if (list) list.push(row)
    else byCategory.set(row.categoryId, [row])
  }

  const out: EnvelopeComputation[] = []
  for (const [categoryId, rows] of byCategory) {
    const startMonth = rows[0].month
    if (startMonth > viewedMonth) continue
    let balance = 0
    let fill = 0
    let spentThisMonth = 0
    let ptr = 0
    for (const month of enumerateMonths(startMonth, viewedMonth)) {
      while (ptr + 1 < rows.length && rows[ptr + 1].month <= month) ptr += 1
      fill = rows[ptr].amount
      const spent = spend.get(`${categoryId}:${month}`) ?? 0
      balance += fill - spent
      if (month === viewedMonth) spentThisMonth = spent
    }
    out.push({ categoryId, startMonth, fill, spent: spentThisMonth, balance })
  }
  return out
}
