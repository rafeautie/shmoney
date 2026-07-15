import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { accounts, budgets, categories, categoryGroups, transactions } from '../db/schema'
import { notTransferSql } from '../db/system-categories'
import { transactionDate } from '../ipc/transactions-page'
import { bucketSql } from '../reports/query'
import { computeEnvelopes, type BudgetFillRow, type EnvelopeComputation } from './rollover'
import type { BudgetSummary, EnvelopeSummary } from '@shared/budgets'

// expense magnitude, matching measureSql('expense') in reports/query.ts
const expenseSql = sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`

// budgets are scalar amounts, so they can't keep currencies apart the way
// report series do; display everything in the most common account currency
function dominantCurrency(): string {
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
  const basePreds = [isNull(transactions.deletedAt), sql`${transactionDate} > 0`]

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
  const unbudgetedPreds = [...basePreds, sql`${monthBucket} = ${month}`, notTransferSql()]
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
      .select({ id: categories.id, name: categories.name, groupName: categoryGroups.name })
      .from(categories)
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(inArray(categories.id, activeIds))
      .all()
    const names = new Map(nameRows.map((r) => [r.id, r]))
    envelopes = computed
      .map((e) => ({
        categoryId: e.categoryId,
        categoryName: names.get(e.categoryId)?.name ?? 'Unknown',
        groupName: names.get(e.categoryId)?.groupName ?? null,
        startMonth: e.startMonth,
        fill: e.fill,
        spent: e.spent,
        balance: e.balance
      }))
      // grouped envelopes sort by group then name; ungrouped ones sink to the end
      .sort((a, b) => {
        if (a.groupName !== b.groupName) {
          if (a.groupName === null) return 1
          if (b.groupName === null) return -1
          return a.groupName.localeCompare(b.groupName)
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
