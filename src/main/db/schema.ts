import { sql } from 'drizzle-orm'
import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
// type-only imports: erased at compile time, so drizzle-kit never resolves them at runtime
import type { ReportFilters, WidgetConfig, WidgetType } from '../../shared/reports'
import type { TransactionFilters } from '../../shared/transaction-filters'
import type { ActionChange, SfinError } from '../../shared/ipc'
import type { RuleConditions, RuleAction } from '../../shared/rules'

// holds at most one row: the app supports a single SimpleFIN connection
export const connections = sqliteTable('connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // base64 of safeStorage.encryptString(accessUrl); decrypted only in the main process
  accessUrlEncrypted: text('access_url_encrypted').notNull(),
  lastSyncedAt: integer('last_synced_at'),
  // errlist from the most recent sync; null once a clean sync clears it
  lastSyncErrors: text('last_sync_errors', { mode: 'json' }).$type<SfinError[]>(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`)
})

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // null connectionId/simplefinId marks a manual account (created by file
    // import): sync never touches it and disconnect's cascade leaves it alone
    connectionId: integer('connection_id').references(() => connections.id, {
      onDelete: 'cascade'
    }),
    simplefinId: text('simplefin_id'),
    institutionName: text('institution_name'),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    // amounts are integer milliunits (value * 1000) so SQL aggregates stay exact
    balance: integer('balance').notNull(),
    availableBalance: integer('available_balance'),
    balanceDate: integer('balance_date').notNull(),
    // user override for institutions that report the balance with the wrong sign;
    // stored raw and flipped at read time so sync can keep overwriting `balance`
    invertBalance: integer('invert_balance', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [uniqueIndex('accounts_connection_sfid_ux').on(t.connectionId, t.simplefinId)]
)

// per-account investment positions, refreshed on every sync. A read-only snapshot
// with no user-owned columns, so sync replaces the whole set per account (see the
// delete-then-insert in connections.ts) rather than upserting.
export const holdings = sqliteTable(
  'holdings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    simplefinId: text('simplefin_id').notNull(),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    // raw SimpleFIN value; often '' or a crypto ticker, so money is displayed in
    // the account's currency instead — market_value is denominated in that.
    currency: text('currency').notNull(),
    // exact decimal string (fractional shares run to ~8 dp); milliunits would round
    shares: text('shares').notNull(),
    // integer milliunits (value * 1000), matching accounts/transactions
    marketValue: integer('market_value').notNull(),
    // milliunits; 0 when the institution doesn't report it (common for crypto)
    costBasis: integer('cost_basis').notNull(),
    purchasePrice: integer('purchase_price').notNull(),
    // holding.created, unix seconds
    createdAt: integer('created_at').notNull()
  },
  (t) => [uniqueIndex('holdings_account_sfid_ux').on(t.accountId, t.simplefinId)]
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
    name: text('name').notNull(),
    // non-null marks a system category ('transfers' | 'income'): seeded rows the
    // app relies on for built-in behavior, protected from rename/delete/reset.
    // Code looks categories up by this key, never by name.
    systemKey: text('system_key')
  },
  (t) => [
    uniqueIndex('categories_group_name_ux').on(t.groupId, t.name),
    // SQLite treats NULLs as distinct in unique indexes, so ungrouped names need their own
    uniqueIndex('categories_ungrouped_name_ux')
      .on(t.name)
      .where(sql`${t.groupId} is null`),
    uniqueIndex('categories_system_key_ux')
      .on(t.systemKey)
      .where(sql`${t.systemKey} is not null`)
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

// append-only audit log of every state change, manual or automated. Each row
// carries the affected fields' before/after values; undo/redo replay them with
// compare-and-set so a newer edit is never clobbered. This is the persistent
// backbone for undo (survives restarts) and the Activity page's history.
export const actionLog = sqliteTable('action_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // unix milliseconds — finer than the app's usual seconds so ordering among
  // rapid successive actions (and their undo order) stays unambiguous
  createdAt: integer('created_at').notNull(),
  // who caused it: 'user' | 'detector' (later: rule ids)
  source: text('source').notNull(),
  // human summary shown in toasts and the Activity list
  label: text('label').notNull(),
  changes: text('changes', { mode: 'json' }).$type<ActionChange[]>().notNull(),
  // unix millis when undone; null = currently applied
  undoneAt: integer('undone_at')
})

// user-defined "if conditions then action" rules. Applied on sync (after the
// transfer detector) and via a manual dry-run-then-apply. Like the detector,
// they only touch untouched rows and log to action_log, so every change is
// reviewable and undoable. conditions/action are versioned JSON.
export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // evaluation order; lower runs first, ties broken by id
  priority: integer('priority').notNull(),
  conditions: text('conditions', { mode: 'json' }).$type<RuleConditions>().notNull(),
  action: text('action', { mode: 'json' }).$type<RuleAction>().notNull(),
  configVersion: integer('config_version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

// "you categorized these identical transactions repeatedly — make it a rule?"
// One row per (description, category) the detector spotted. A pair suppresses
// re-suggesting only while it's active — pending, or accepted with its rule
// still in force; categorizing the cluster again reactivates a dismissed or
// orphaned pair (see detectRuleSuggestions). The surfaces show pending ones.
export const ruleSuggestions = sqliteTable(
  'rule_suggestions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // the exact transaction description the cluster shares
    descriptionKey: text('description_key').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // matching-transaction count when first spotted (the live list recomputes it)
    matchCount: integer('match_count').notNull(),
    // what categorized the cluster: 'user' | 'llm'
    source: text('source').notNull(),
    // 'pending' | 'dismissed' | 'accepted'
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('rule_suggestions_key_category_ux').on(t.descriptionKey, t.categoryId)]
)

// envelope budgets: sparse per-month fill amounts. The effective fill for month
// M is the row with the greatest month <= M (inherit-forward); an envelope
// exists for a category iff it has any row, and starts at its min(month).
export const budgets = sqliteTable(
  'budgets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // 'YYYY-MM', matching the reports month-bucket label
    month: text('month').notNull(),
    // integer milliunits, >= 0 (enforced in zod)
    amount: integer('amount').notNull()
  },
  (t) => [uniqueIndex('budgets_category_month_ux').on(t.categoryId, t.month)]
)

export type ConnectionRow = typeof connections.$inferSelect
export type AccountRow = typeof accounts.$inferSelect
export type HoldingRow = typeof holdings.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect
export type CategoryGroupRow = typeof categoryGroups.$inferSelect
export type CategoryRow = typeof categories.$inferSelect
export type ReportRow = typeof reports.$inferSelect
export type ReportWidgetRow = typeof reportWidgets.$inferSelect
export type SavedFilterRow = typeof savedFilters.$inferSelect
export type SettingRow = typeof settings.$inferSelect
export type ActionLogRow = typeof actionLog.$inferSelect
export type RuleRow = typeof rules.$inferSelect
export type RuleSuggestionRow = typeof ruleSuggestions.$inferSelect
export type BudgetRow = typeof budgets.$inferSelect
