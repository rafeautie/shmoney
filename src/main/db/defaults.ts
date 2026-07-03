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

// Must stay in sync with the one-time seed in drizzle/0005_seed_income.sql
export const DEFAULT_UNGROUPED_CATEGORIES: string[] = ['💵 Income']

/** Replaces all groups/categories with the defaults and uncategorizes every transaction. */
export function resetCategoriesToDefaults(): void {
  db.transaction((tx) => {
    tx.update(transactions).set({ categoryId: null }).run()
    tx.delete(categories).run()
    tx.delete(categoryGroups).run()
    for (const group of DEFAULT_CATEGORY_GROUPS) {
      const [groupRow] = tx.insert(categoryGroups).values({ name: group.name }).returning().all()
      tx.insert(categories)
        .values(group.categories.map((name) => ({ groupId: groupRow.id, name })))
        .run()
    }
    tx.insert(categories)
      .values(DEFAULT_UNGROUPED_CATEGORIES.map((name) => ({ groupId: null, name })))
      .run()
  })
}
