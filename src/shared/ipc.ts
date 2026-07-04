import { z } from 'zod'

export interface Connection {
  lastSyncedAt: number | null
  createdAt: string
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
}

export interface Category {
  id: number
  /** null = ungrouped */
  groupId: number | null
  name: string
}

export interface CategoryGroup {
  id: number
  name: string
  categories: Category[]
}

export interface CategoriesList {
  groups: CategoryGroup[]
  ungrouped: Category[]
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

export const transactionSetCategorySchema = z.object({
  transactionId: idSchema,
  categoryId: idSchema.nullable()
})
export type TransactionSetCategoryInput = z.infer<typeof transactionSetCategorySchema>

// bulk actions silently skip pending rows: sync drops and re-inserts them, so
// any change to them would be lost on the next sync.
// per-row category values (rather than one value for all ids) let undo restore
// each transaction's previous category in a single call
export const transactionsSetCategoriesSchema = z.object({
  changes: z.array(z.object({ transactionId: idSchema, categoryId: idSchema.nullable() })).min(1)
})
export type TransactionsSetCategoriesInput = z.infer<typeof transactionsSetCategoriesSchema>

export const transactionIdsSchema = z.object({
  transactionIds: z.array(idSchema).min(1)
})
export type TransactionIdsInput = z.infer<typeof transactionIdsSchema>

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
  accountTransactions: 'accounts:transactions',
  transactionsList: 'transactions:list',
  transactionsSetCategory: 'transactions:setCategory',
  transactionsSetCategories: 'transactions:setCategories',
  transactionsBulkDelete: 'transactions:bulkDelete',
  transactionsRestore: 'transactions:restore',
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
  windowMaximizedChanged: 'window:maximizedChanged'
} as const
