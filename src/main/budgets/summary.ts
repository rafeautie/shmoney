import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { db } from '../db'
import { accounts, budgets, categories, categoryGroups, transactions } from '../db/schema'
import { notOpeningSql, notTransferSql } from '../db/system-categories'
import { bucketSql } from '../reports/query'
import { computeEnvelopes, type BudgetFillRow, type EnvelopeComputation } from './rollover'
import type { BudgetSummary, EnvelopeSummary } from '@shared/budgets'

// expense magnitude, matching measureSql('expense') in reports/query.ts
const expenseSql = sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`

const DAY_SECONDS = 24 * 60 * 60

/**
 * A plain epoch range around the local months from..to ('YYYY-MM'), so the
 * date index can narrow rows before the exact local-month test runs on them.
 * A day of slack each side covers every UTC offset.
 */
function monthSpan(from: string, to: string): SQL {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  return and(
    gte(transactions.effectiveDate, Date.UTC(fromYear, fromMonth - 1, 1) / 1000 - DAY_SECONDS),
    lt(transactions.effectiveDate, Date.UTC(toYear, toMonth, 1) / 1000 + DAY_SECONDS)
  )!
}

// budgets are scalar amounts, so they can't keep currencies apart the way
// report series do; display everything in the most common account currency
export function dominantCurrency(): string {
  const row = db
    .select({ currency: accounts.currency })
    .from(accounts)
    .groupBy(accounts.currency)
    .orderBy(sql`count(*) desc`, asc(accounts.currency))
    .limit(1)
    .get()
  return row?.currency ?? 'USD'
}

export function getBudgetSummary(month: string): BudgetSummary {
  const budgetRows: BudgetFillRow[] = db
    .select({ categoryId: budgets.categoryId, month: budgets.month, amount: budgets.amount })
    .from(budgets)
    .orderBy(asc(budgets.categoryId), asc(budgets.month))
    .all()

  const currency = dominantCurrency()
  const monthBucket = bucketSql('month')
  // a starting balance is account setup, not money budgeted or spent; without
  // this it would land in the unbudgeted bucket as a large one-off income
  const basePreds = [
    isNull(transactions.deletedAt),
    gt(transactions.effectiveDate, 0),
    notOpeningSql()
  ]

  let computed: EnvelopeComputation[] = []
  let minMonth: string | null = null
  if (budgetRows.length > 0) {
    minMonth = budgetRows.reduce((min, r) => (r.month < min ? r.month : min), budgetRows[0].month)
    const categoryIds = [...new Set(budgetRows.map((r) => r.categoryId))]
    const spendRows = db
      .select({ categoryId: transactions.categoryId, month: monthBucket, spent: expenseSql })
      .from(transactions)
      .where(
        and(
          ...basePreds,
          inArray(transactions.categoryId, categoryIds),
          monthSpan(minMonth, month),
          sql`${monthBucket} >= ${minMonth}`,
          sql`${monthBucket} <= ${month}`
        )
      )
      .groupBy(transactions.categoryId, monthBucket)
      .all()
    const spend = new Map(spendRows.map((r) => [`${r.categoryId}:${r.month}`, r.spent]))
    computed = computeEnvelopes(budgetRows, spend, month)
  }

  // spending this month outside every active envelope (uncategorized included,
  // Transfers excluded). Envelopes that start after the viewed month don't
  // count as budgeted for it, so their spending lands here too.
  const activeIds = computed.map((e) => e.categoryId)
  const unbudgetedPreds = [
    ...basePreds,
    monthSpan(month, month),
    sql`${monthBucket} = ${month}`,
    notTransferSql()
  ]
  if (activeIds.length > 0) {
    unbudgetedPreds.push(
      or(isNull(transactions.categoryId), notInArray(transactions.categoryId, activeIds))!
    )
  }
  const unbudgetedSpent =
    db
      .select({ spent: expenseSql })
      .from(transactions)
      .where(and(...unbudgetedPreds))
      .get()?.spent ?? 0

  let envelopes: EnvelopeSummary[] = []
  if (computed.length > 0) {
    const nameRows = db
      .select({
        id: categories.id,
        name: categories.name,
        groupId: categories.groupId,
        groupName: categoryGroups.name
      })
      .from(categories)
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(inArray(categories.id, activeIds))
      .all()
    const names = new Map(nameRows.map((r) => [r.id, r]))
    envelopes = computed
      .map((e) => ({
        categoryId: e.categoryId,
        categoryName: names.get(e.categoryId)?.name ?? 'Unknown',
        groupId: names.get(e.categoryId)?.groupId ?? null,
        groupName: names.get(e.categoryId)?.groupName ?? null,
        startMonth: e.startMonth,
        fill: e.fill,
        spent: e.spent,
        balance: e.balance
      }))
      // groups in creation order, as Settings > Categories lists them; ungrouped last
      .sort((a, b) => {
        if (a.groupId !== b.groupId) {
          if (a.groupId === null) return 1
          if (b.groupId === null) return -1
          return a.groupId - b.groupId
        }
        return a.categoryName.localeCompare(b.categoryName)
      })
  }

  return {
    month,
    minMonth,
    currency,
    envelopes,
    unbudgetedSpent,
    totals: {
      fill: envelopes.reduce((s, e) => s + e.fill, 0),
      spent: envelopes.reduce((s, e) => s + e.spent, 0),
      balance: envelopes.reduce((s, e) => s + e.balance, 0)
    }
  }
}
