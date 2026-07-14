import { inArray, isNull } from 'drizzle-orm'
import { db } from './index'
import { categoryGroups, categories, transactions } from './schema'

// Must stay in sync with the one-time seed in drizzle/0003_seed_default_categories.sql
export const DEFAULT_CATEGORY_GROUPS: { name: string; categories: string[] }[] = [
  {
    name: '🎉 Wants',
    categories: [
      '📺 Subscriptions',
      '🛍️ Shopping',
      '🎨 Hobbies',
      '🎬 Entertainment',
      '🍽️ Dining Out'
    ]
  },
  {
    name: '📌 Needs',
    categories: [
      '💡 Utilities',
      '🚗 Transportation',
      '🛡️ Insurance',
      '🏠 Housing',
      '⚕️ Healthcare',
      '🛒 Groceries'
    ]
  },
  {
    name: '💰 Savings & Debt',
    categories: ['🏖️ Retirement', '📈 Investments', '🚨 Emergency Fund', '💳 Debt Payments']
  }
]

export type SystemCategoryKey = 'income' | 'transfers'

// System categories back built-in behavior (Transfers replaces the old
// is_transfer flag) and can't be renamed or deleted; reset preserves them.
// Must stay in sync with the one-time seeds in drizzle/0005_seed_income.sql and
// drizzle/0016_seed_system_categories.sql.
export const SYSTEM_CATEGORIES: { key: SystemCategoryKey; name: string }[] = [
  { key: 'income', name: '💵 Income' },
  { key: 'transfers', name: '🔄 Transfers' }
]

/**
 * Replaces all user groups/categories with the defaults and uncategorizes their
 * transactions. System categories survive, and so do the transactions assigned
 * to them — otherwise every reset would silently unmark all transfers.
 */
export function resetCategoriesToDefaults(): void {
  db.transaction((tx) => {
    const userCategoryIds = tx
      .select({ id: categories.id })
      .from(categories)
      .where(isNull(categories.systemKey))
      .all()
      .map((r) => r.id)
    if (userCategoryIds.length > 0) {
      tx.update(transactions)
        .set({ categoryId: null })
        .where(inArray(transactions.categoryId, userCategoryIds))
        .run()
      tx.delete(categories).where(inArray(categories.id, userCategoryIds)).run()
    }
    tx.delete(categoryGroups).run()
    for (const group of DEFAULT_CATEGORY_GROUPS) {
      const [groupRow] = tx.insert(categoryGroups).values({ name: group.name }).returning().all()
      tx.insert(categories)
        .values(group.categories.map((name) => ({ groupId: groupRow.id, name })))
        .run()
    }
  })
}
