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
  /** null ⇔ manual account created by file import */
  connectionId: number | null
  simplefinId: string | null
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
  /** sync overwrites amount/description/date on these rows; only the category is user-editable */
  syncOwned: boolean
}

/**
 * Whether sync owns a transaction's amount/description/date: rows on a connected
 * account whose id came from SimpleFIN. `manual:`/`import:` prefixed ids are
 * app-generated and can never collide with the bank's, so sync's upsert can't
 * touch them even on a connected account.
 */
export function isSyncOwned(connectionId: number | null, simplefinId: string): boolean {
  if (connectionId === null) return false
  return !simplefinId.startsWith('manual:') && !simplefinId.startsWith('import:')
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

/** Counts over the visible (non-deleted) transactions; uncategorized = category_id IS NULL. */
export interface TransactionStats {
  total: number
  uncategorized: number
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

// manual transaction entry (the "Create transaction" dialog). The amount is
// signed integer milliunits like everywhere else — negative is money out — and
// `date` is the calendar day the row is anchored to at local noon.
export const transactionCreateSchema = z.object({
  accountId: accountIdSchema,
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Amount must not be zero'),
  description: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date'),
  categoryId: idSchema.nullable()
})
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>

// editing one transaction from the edit dialog. Omitted fields are unchanged;
// `categoryId: null` present means "set to Uncategorized". The server rejects
// amount/description/date on sync-owned rows (see isSyncOwned).
export const transactionUpdateSchema = z.object({
  id: idSchema,
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Amount must not be zero')
    .optional(),
  description: z.string().trim().min(1).max(200).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
    .optional(),
  categoryId: idSchema.nullable().optional()
})
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>

// scope for a categorize run: an explicit selection, one account, or — with both
// omitted — every eligible transaction. transactionIds wins when both are present.
export const categorizeScopeSchema = z.object({
  transactionIds: z.array(idSchema).min(1).optional(),
  accountId: accountIdSchema.optional()
})
export type CategorizeScopeInput = z.infer<typeof categorizeScopeSchema>

// ---------- action log (audit trail + undo/redo) ----------

export type ActionSource = 'user' | 'detector' | 'rule' | 'llm' | 'import'

// the numeric transaction columns undo/redo may rewrite. These strings double as
// the drizzle set-keys in the main-process engine, so they must match schema
// props. `description` is string-valued so it gets its own change variant below.
export type ActionField = 'categoryId' | 'deletedAt' | 'amount' | 'posted'

export type TransactionActionChange =
  | {
      transactionId: number
      field: ActionField
      /** raw stored values (number|null) */
      before: number | null
      after: number | null
    }
  | {
      transactionId: number
      field: 'description'
      before: string
      after: string
    }

/** Narrow an ActionChange to the transaction variants (any field incl. description). */
export function isTransactionChange(c: ActionChange): c is TransactionActionChange {
  return 'transactionId' in c
}

/**
 * Diff a transaction edit's provided fields against the stored row, one change
 * per field that actually differs — the action-log entry for transactions:update.
 * Lives here (not in the main process) so it stays free of DB imports and
 * unit-testable; better-sqlite3 can't load under vitest.
 */
export function buildUpdateChanges(
  current: { amount: number; description: string; posted: number; categoryId: number | null },
  input: { amount?: number; description?: string; posted?: number; categoryId?: number | null },
  transactionId: number
): TransactionActionChange[] {
  const changes: TransactionActionChange[] = []
  if (input.amount !== undefined && input.amount !== current.amount) {
    changes.push({ transactionId, field: 'amount', before: current.amount, after: input.amount })
  }
  if (input.description !== undefined && input.description !== current.description) {
    changes.push({
      transactionId,
      field: 'description',
      before: current.description,
      after: input.description
    })
  }
  if (input.posted !== undefined && input.posted !== current.posted) {
    changes.push({ transactionId, field: 'posted', before: current.posted, after: input.posted })
  }
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    changes.push({
      transactionId,
      field: 'categoryId',
      before: current.categoryId,
      after: input.categoryId
    })
  }
  return changes
}

/** A budget fill change for one (category, month); null = no fill row. */
export interface BudgetActionChange {
  field: 'budgetAmount'
  categoryId: number
  month: string
  before: number | null
  after: number | null
}

/** A chat conversation rename or soft delete. Field names are prefixed so they
 *  can't collide with the transaction fields. */
export type ConversationActionChange =
  | {
      field: 'conversationTitle'
      conversationId: number
      before: string | null
      after: string
    }
  | {
      field: 'conversationDeletedAt'
      conversationId: number
      /** the title at delete time, for the Activity list */
      title: string | null
      /** unix milliseconds (conversations.deletedAt convention) */
      before: number | null
      after: number | null
    }

export type ActionChange = TransactionActionChange | BudgetActionChange | ConversationActionChange

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
  | ConversationActionChange

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
  accountsDelete: 'accounts:delete',
  accountHoldings: 'accounts:holdings',
  accountTransactions: 'accounts:transactions',
  transactionsList: 'transactions:list',
  transactionsStats: 'transactions:stats',
  transactionsSetCategories: 'transactions:setCategories',
  transactionsBulkDelete: 'transactions:bulkDelete',
  transactionsCreate: 'transactions:create',
  transactionsUpdate: 'transactions:update',
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
