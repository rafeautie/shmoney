import { sql } from 'drizzle-orm'
import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// holds at most one row: the app supports a single SimpleFIN connection
export const connections = sqliteTable('connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // base64 of safeStorage.encryptString(accessUrl); decrypted only in the main process
  accessUrlEncrypted: text('access_url_encrypted').notNull(),
  lastSyncedAt: integer('last_synced_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`)
})

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    simplefinId: text('simplefin_id').notNull(),
    institutionName: text('institution_name'),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    // amounts are integer milliunits (value * 1000) so SQL aggregates stay exact
    balance: integer('balance').notNull(),
    availableBalance: integer('available_balance'),
    balanceDate: integer('balance_date').notNull()
  },
  (t) => [uniqueIndex('accounts_connection_sfid_ux').on(t.connectionId, t.simplefinId)]
)

export const categoryGroups = sqliteTable(
  'category_groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull()
  },
  (t) => [uniqueIndex('category_groups_name_ux').on(t.name)]
)

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // null = ungrouped
    groupId: integer('group_id').references(() => categoryGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull()
  },
  (t) => [
    uniqueIndex('categories_group_name_ux').on(t.groupId, t.name),
    // SQLite treats NULLs as distinct in unique indexes, so ungrouped names need their own
    uniqueIndex('categories_ungrouped_name_ux')
      .on(t.name)
      .where(sql`${t.groupId} is null`)
  ]
)

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    simplefinId: text('simplefin_id').notNull(),
    posted: integer('posted').notNull(),
    amount: integer('amount').notNull(),
    description: text('description').notNull(),
    pending: integer('pending', { mode: 'boolean' }).notNull().default(false),
    transactedAt: integer('transacted_at'),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' })
  },
  (t) => [uniqueIndex('transactions_account_sfid_ux').on(t.accountId, t.simplefinId)]
)

export type ConnectionRow = typeof connections.$inferSelect
export type AccountRow = typeof accounts.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect
export type CategoryGroupRow = typeof categoryGroups.$inferSelect
export type CategoryRow = typeof categories.$inferSelect
