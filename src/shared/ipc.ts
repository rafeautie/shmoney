import { z } from 'zod'

export interface Connection {
  id: number
  name: string
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
  posted: number
  /** Integer milliunits (value * 1000) */
  amount: number
  description: string
  pending: boolean
}

export interface Page<T> {
  rows: T[]
  total: number
}

export const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  setupToken: z.string().trim().min(1)
})
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>

export const connectionIdSchema = z.number().int().positive()
export const accountIdSchema = z.number().int().positive()

const pageFields = {
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
  sortDir: z.enum(['asc', 'desc'])
}

export const connectionsQuerySchema = z.object({
  ...pageFields,
  sortBy: z.enum(['name', 'lastSyncedAt'])
})
export type ConnectionsQuery = z.infer<typeof connectionsQuerySchema>

const transactionSortBy = z.enum(['posted', 'accountName', 'description', 'amount'])

export const accountTransactionsQuerySchema = z.object({
  ...pageFields,
  accountId: accountIdSchema,
  sortBy: transactionSortBy
})
export type AccountTransactionsQuery = z.infer<typeof accountTransactionsQuerySchema>

export const connectionTransactionsQuerySchema = z.object({
  ...pageFields,
  connectionId: connectionIdSchema,
  sortBy: transactionSortBy
})
export type ConnectionTransactionsQuery = z.infer<typeof connectionTransactionsQuerySchema>

export const IPC = {
  connectionsList: 'connections:list',
  connectionsGet: 'connections:get',
  connectionsCreate: 'connections:create',
  connectionsSync: 'connections:sync',
  connectionsRemove: 'connections:remove',
  accountsList: 'accounts:list',
  accountsGet: 'accounts:get',
  accountTransactions: 'accounts:transactions',
  transactionsList: 'connections:transactions'
} as const
