import { sql } from 'drizzle-orm'
import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
// type-only imports: erased at compile time, so drizzle-kit never resolves them at runtime
import type { ReportFilters, WidgetConfig, WidgetType } from '../../shared/reports'
import type { TransactionFilters } from '../../shared/transaction-filters'

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
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    // soft delete (unix seconds): read paths exclude these rows; sync upserts
    // must never touch this column or deletes would revert on every sync
    deletedAt: integer('deleted_at')
  },
  (t) => [uniqueIndex('transactions_account_sfid_ux').on(t.accountId, t.simplefinId)]
)

export const reports = sqliteTable('reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // report-level filter bar state
  filters: text('filters', { mode: 'json' }).$type<ReportFilters>().notNull(),
  configVersion: integer('config_version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const reportWidgets = sqliteTable('report_widgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reportId: integer('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  type: text('type').$type<WidgetType>().notNull(),
  // query spec + display options + filter overrides; versioned so old configs degrade safely
  config: text('config', { mode: 'json' }).$type<WidgetConfig>().notNull(),
  configVersion: integer('config_version').notNull().default(1),
  // 12-column grid position and size
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  w: integer('w').notNull(),
  h: integer('h').notNull()
})

// user-named filter presets, loadable from any transactions view or report
export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    filters: text('filters', { mode: 'json' }).$type<TransactionFilters>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('saved_filters_name_ux').on(t.name)]
)

// generic key/value store for small user preferences (theme, privacy blur, sidebar state);
// values are validated per-key with zod in the settings IPC handler
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull()
})

export type ConnectionRow = typeof connections.$inferSelect
export type AccountRow = typeof accounts.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect
export type CategoryGroupRow = typeof categoryGroups.$inferSelect
export type CategoryRow = typeof categories.$inferSelect
export type ReportRow = typeof reports.$inferSelect
export type ReportWidgetRow = typeof reportWidgets.$inferSelect
export type SavedFilterRow = typeof savedFilters.$inferSelect
export type SettingRow = typeof settings.$inferSelect
