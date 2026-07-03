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
  transactionsList: 'transactions:list'
} as const
