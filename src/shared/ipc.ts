import { z } from 'zod'

/** A single entry from SimpleFIN's errlist. `code` is `prefix.subcode`; see {@link sfinErrorSeverity}. */
export interface SfinError {
  code: string
  msg: string
}

/**
 * How the user should treat an errlist entry:
 * - 'action'    an auth failure (`gen.auth` / `con.auth`) — nothing syncs correctly
 *               until they reconnect or re-authorize the institution at the bridge.
 * - 'transient' a retry-advised account error (`act.failed` / `act.missingdata`) or a
 *               bridge notice (e.g. a capped date range) that clears on a later sync.
 * - 'developer' API misuse (`gen.api`), which the protocol marks "meant for the
 *               developer and not the user" — log it, never show it on the card.
 */
export type SfinErrorSeverity = 'action' | 'transient' | 'developer'

/** Classify an errlist entry per https://www.simplefin.org/protocol.html#error */
export function sfinErrorSeverity({ code }: SfinError): SfinErrorSeverity {
  if (code === 'gen.api') return 'developer'
  return code === 'gen.auth' || code === 'con.auth' ? 'action' : 'transient'
}

export interface Connection {
  lastSyncedAt: number | null
  createdAt: string
  /** errlist from the most recent sync; empty once a clean sync clears it */
  lastSyncErrors: SfinError[]
}

export interface SyncResult extends Connection {
  /** transfer pairs the detector auto-marked during this sync */
  detectedTransfers: number
  /** transactions categorized by rules during this sync */
  rulesApplied: number
}

export interface Account {
  id: number
  connectionId: number
  simplefinId: string
  institutionName: string | null
  name: string
  currency: string
  /** Integer milliunits (value * 1000) */
  balance: number
  availableBalance: number | null
  balanceDate: number
  /** user override: when true, `balance`/`availableBalance` above are already sign-flipped */
  invertBalance: boolean
  /** number of investment positions on this account; 0 = not an investment account */
  holdingsCount: number
}

export interface Holding {
  id: number
  accountId: number
  simplefinId: string
  symbol: string
  description: string
  /** raw SimpleFIN currency (may be '' or a ticker); display money in the account's currency */
  currency: string
  /** exact decimal string from SimpleFIN (fractional shares, up to ~8 dp) */
  shares: string
  /** Integer milliunits (value * 1000), in the account's currency */
  marketValue: number
  /** Integer milliunits; 0 when the institution doesn't report it */
  costBasis: number
  /** Integer milliunits; 0 when not reported */
  purchasePrice: number
  /** unix seconds when the holding was created at the bridge */
  createdAt: number
}

export interface Transaction {
  id: number
  accountId: number
  accountName: string
  currency: string
  /** Unix seconds: posted date, or transacted_at for pending rows; 0 when unknown */
  date: number
  /** Integer milliunits (value * 1000) */
  amount: number
  description: string
  pending: boolean
  categoryId: number | null
  categoryName: string | null
  /** derived: in the Transfers system category — excluded from income/expense */
  isTransfer: boolean
}

export interface Category {
  id: number
  /** null = ungrouped */
  groupId: number | null
  name: string
  /** non-null marks a system category ('transfers' | 'income'): not renameable or deletable */
  systemKey: string | null
}

export interface CategoryGroup {
  id: number
  name: string
  categories: Category[]
}

export interface CategoriesList {
  groups: CategoryGroup[]
  ungrouped: Category[]
  /** system categories (Transfers, Income): listed separately, not editable */
  system: Category[]
}

export interface Page<T> {
  rows: T[]
  total: number
}

export const connectInputSchema = z.object({
  setupToken: z.string().trim().min(1)
})
export type ConnectInput = z.infer<typeof connectInputSchema>

export const accountIdSchema = z.number().int().positive()

export const setInvertBalanceInputSchema = z.object({
  accountId: accountIdSchema,
  invertBalance: z.boolean()
})
export type SetInvertBalanceInput = z.infer<typeof setInvertBalanceInputSchema>

export const idSchema = z.number().int().positive()

const categoryNameSchema = z.string().trim().min(1).max(60)

export const categoryGroupCreateSchema = z.object({
  name: categoryNameSchema
})
export type CategoryGroupCreateInput = z.infer<typeof categoryGroupCreateSchema>

export const categoryGroupRenameSchema = z.object({
  id: idSchema,
  name: categoryNameSchema
})
export type CategoryGroupRenameInput = z.infer<typeof categoryGroupRenameSchema>

export const categoryCreateSchema = z.object({
  /** null = ungrouped */
  groupId: idSchema.nullable(),
  name: categoryNameSchema
})
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>

export const categoryRenameSchema = z.object({
  id: idSchema,
  name: categoryNameSchema
})
export type CategoryRenameInput = z.infer<typeof categoryRenameSchema>

// bulk actions silently skip pending rows: sync drops and re-inserts them, so
// any change to them would be lost on the next sync.
// per-row category values (rather than one value for all ids) let undo restore
// each transaction's previous category in a single call
export const transactionsSetCategoriesSchema = z.object({
  changes: z.array(z.object({ transactionId: idSchema, categoryId: idSchema.nullable() })).min(1),
  // who's setting the category; omitted = the normal user-driven path
  source: z.enum(['user', 'llm']).optional()
})
export type TransactionsSetCategoriesInput = z.infer<typeof transactionsSetCategoriesSchema>

export const transactionIdsSchema = z.object({
  transactionIds: z.array(idSchema).min(1)
})
export type TransactionIdsInput = z.infer<typeof transactionIdsSchema>

// scope for a categorize run: an explicit selection, one account, or — with both
// omitted — every eligible transaction. transactionIds wins when both are present.
export const categorizeScopeSchema = z.object({
  transactionIds: z.array(idSchema).min(1).optional(),
  accountId: accountIdSchema.optional()
})
export type CategorizeScopeInput = z.infer<typeof categorizeScopeSchema>

// ---------- action log (audit trail + undo/redo) ----------

export type ActionSource = 'user' | 'detector' | 'rule' | 'llm'

// the transaction columns undo/redo may rewrite. These strings double as the
// drizzle set-keys in the main-process engine, so they must match schema props.
export type ActionField = 'categoryId' | 'deletedAt'

export interface TransactionActionChange {
  transactionId: number
  field: ActionField
  /** raw stored values (number|null for both fields) */
  before: number | null
  after: number | null
}

/** A budget fill change for one (category, month); null = no fill row. */
export interface BudgetActionChange {
  field: 'budgetAmount'
  categoryId: number
  month: string
  before: number | null
  after: number | null
}

export type ActionChange = TransactionActionChange | BudgetActionChange

/** A change enriched with its current context, for the Activity list. */
export type ActionLogChange =
  | (TransactionActionChange & {
      /** null when the transaction no longer exists (e.g. after a disconnect) */
      description: string | null
      accountName: string | null
      amount: number | null
      currency: string | null
      date: number | null
    })
  | (BudgetActionChange & {
      /** null when the category no longer exists */
      categoryName: string | null
      /** dominant account currency, for display */
      currency: string
    })

export interface ActionLogEntry {
  id: number
  /** unix milliseconds */
  createdAt: number
  source: ActionSource
  label: string
  /** unix millis when undone; null = currently applied */
  undoneAt: number | null
  changes: ActionLogChange[]
}

/** Result of undo/redo: applied = rows actually changed (0 = fully superseded). */
export interface UndoResult {
  /** the entry that was undone/redone, so callers can reverse that exact one */
  id: number
  label: string
  applied: number
}

const pageFields = {
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
  sortDir: z.enum(['asc', 'desc'])
}

export const transactionSortBySchema = z.enum(['date', 'accountName', 'description', 'amount'])
export type TransactionSortBy = z.infer<typeof transactionSortBySchema>

export const transactionsQuerySchema = z.object({
  ...pageFields,
  sortBy: transactionSortBySchema
})
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>

export const accountTransactionsQuerySchema = transactionsQuerySchema.extend({
  accountId: accountIdSchema
})
export type AccountTransactionsQuery = z.infer<typeof accountTransactionsQuerySchema>

export const IPC = {
  connectionGet: 'connection:get',
  connectionConnect: 'connection:connect',
  connectionSync: 'connection:sync',
  connectionDisconnect: 'connection:disconnect',
  accountsList: 'accounts:list',
  accountsGet: 'accounts:get',
  accountsSetInvertBalance: 'accounts:setInvertBalance',
  accountHoldings: 'accounts:holdings',
  accountTransactions: 'accounts:transactions',
  transactionsList: 'transactions:list',
  transactionsSetCategories: 'transactions:setCategories',
  transactionsBulkDelete: 'transactions:bulkDelete',
  categoriesList: 'categories:list',
  categoriesCreateGroup: 'categories:createGroup',
  categoriesRenameGroup: 'categories:renameGroup',
  categoriesDeleteGroup: 'categories:deleteGroup',
  categoriesCreate: 'categories:create',
  categoriesRename: 'categories:rename',
  categoriesDelete: 'categories:delete',
  categoriesResetDefaults: 'categories:resetDefaults',
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximizeToggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',
  windowMaximizedChanged: 'window:maximizedChanged',
  // dev-only: raw SimpleFIN /accounts passthrough for the Debug page (handler
  // registered only when is.dev, so it isn't present in production builds)
  debugRawAccounts: 'debug:rawAccounts'
} as const

export const ACTION_LOG_IPC = {
  list: 'actionLog:list',
  // keyboard Ctrl+Z/Y: act on the newest applied / newest undone entry
  undo: 'actionLog:undo',
  redo: 'actionLog:redo',
  // Activity page: act on a specific entry
  undoEntry: 'actionLog:undoEntry',
  redoEntry: 'actionLog:redoEntry'
} as const
