import { ipcMain, safeStorage } from 'electron'
import { and, asc, count, desc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { db } from '../db'
import { connections, accounts, transactions } from '../db/schema'
import type { ConnectionRow } from '../db/schema'
import { claimAccessUrl, fetchAccounts, parseAmount } from '../simplefin'
import {
  IPC,
  connectInputSchema,
  accountIdSchema,
  accountTransactionsQuerySchema,
  transactionsQuerySchema,
  type Connection,
  type Page,
  type Transaction
} from '@shared/ipc'

const FIRST_SYNC_WINDOW_SECONDS = 90 * 24 * 60 * 60
const RESYNC_OVERLAP_SECONDS = 7 * 24 * 60 * 60

function toConnection(row: ConnectionRow): Connection {
  // accessUrlEncrypted deliberately never crosses IPC
  return { lastSyncedAt: row.lastSyncedAt, createdAt: row.createdAt }
}

// the app supports a single SimpleFIN connection; oldest row wins if legacy data has more
function connectionRow(): ConnectionRow | undefined {
  return db.select().from(connections).orderBy(asc(connections.id)).limit(1).get()
}

function order(column: SQLWrapper, dir: 'asc' | 'desc'): SQL {
  return dir === 'asc' ? asc(column) : desc(column)
}

async function syncConnection(): Promise<Connection> {
  const row = connectionRow()
  if (!row) throw new Error('Not connected to SimpleFIN')

  const accessUrl = safeStorage.decryptString(Buffer.from(row.accessUrlEncrypted, 'base64'))
  const now = Math.floor(Date.now() / 1000)
  const startDate = row.lastSyncedAt
    ? row.lastSyncedAt - RESYNC_OVERLAP_SECONDS
    : now - FIRST_SYNC_WINDOW_SECONDS

  const payload = await fetchAccounts(accessUrl, startDate)
  const institutionByConnId = new Map(payload.connections.map((c) => [c.conn_id, c.name]))

  const [updated] = db.transaction((tx) => {
    for (const account of payload.accounts) {
      const values = {
        connectionId: row.id,
        simplefinId: account.id,
        institutionName: account.conn_id
          ? (institutionByConnId.get(account.conn_id) ?? null)
          : null,
        name: account.name,
        currency: account.currency,
        balance: parseAmount(account.balance),
        availableBalance: account['available-balance']
          ? parseAmount(account['available-balance'])
          : null,
        balanceDate: account['balance-date']
      }
      const [accountRow] = tx
        .insert(accounts)
        .values(values)
        .onConflictDoUpdate({
          target: [accounts.connectionId, accounts.simplefinId],
          set: values
        })
        .returning()
        .all()

      // pending transaction ids aren't stable once they post; drop and re-add
      tx.delete(transactions)
        .where(and(eq(transactions.accountId, accountRow.id), eq(transactions.pending, true)))
        .run()

      for (const txn of account.transactions) {
        const txnValues = {
          accountId: accountRow.id,
          simplefinId: txn.id,
          posted: txn.posted,
          amount: parseAmount(txn.amount),
          description: txn.description,
          pending: txn.pending ?? false,
          transactedAt: txn.transacted_at ?? null
        }
        tx.insert(transactions)
          .values(txnValues)
          .onConflictDoUpdate({
            target: [transactions.accountId, transactions.simplefinId],
            set: txnValues
          })
          .run()
      }
    }

    return tx
      .update(connections)
      .set({ lastSyncedAt: now })
      .where(eq(connections.id, row.id))
      .returning()
      .all()
  })

  return toConnection(updated)
}

// SimpleFIN sends posted = 0 for pending transactions; their real date is transacted_at
const transactionDate = sql<number>`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, 0)`

const transactionSortColumns = {
  date: transactionDate,
  accountName: accounts.name,
  description: transactions.description,
  amount: transactions.amount
} as const

function transactionsPage(
  where: SQL | undefined,
  q: {
    page: number
    pageSize: number
    sortBy: keyof typeof transactionSortColumns
    sortDir: 'asc' | 'desc'
  }
): Page<Transaction> {
  const rows = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      currency: accounts.currency,
      date: transactionDate,
      amount: transactions.amount,
      description: transactions.description,
      pending: transactions.pending
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(where)
    .orderBy(order(transactionSortColumns[q.sortBy], q.sortDir))
    .limit(q.pageSize)
    .offset(q.page * q.pageSize)
    .all()
  const total =
    db
      .select({ value: count() })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(where)
      .get()?.value ?? 0
  return { rows, total }
}

export function registerConnectionsIpc(): void {
  ipcMain.handle(IPC.connectionGet, () => {
    const row = connectionRow()
    return row ? toConnection(row) : null
  })

  ipcMain.handle(IPC.connectionConnect, async (_event, input: unknown) => {
    const { setupToken } = connectInputSchema.parse(input)
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Credential encryption is not available on this system')
    }
    if (connectionRow()) {
      throw new Error('Already connected to SimpleFIN. Disconnect first to use a new setup token.')
    }
    // Claim + store only; sync is a separate call so a failed sync never burns
    // the single-use setup token.
    const accessUrl = await claimAccessUrl(setupToken)
    if (connectionRow()) {
      throw new Error('Already connected to SimpleFIN. Disconnect first to use a new setup token.')
    }
    const accessUrlEncrypted = safeStorage.encryptString(accessUrl).toString('base64')
    const [row] = db.insert(connections).values({ accessUrlEncrypted }).returning().all()
    return toConnection(row)
  })

  ipcMain.handle(IPC.connectionSync, () => {
    return syncConnection()
  })

  ipcMain.handle(IPC.connectionDisconnect, () => {
    // cascades to accounts and transactions
    db.delete(connections).run()
    return true
  })

  ipcMain.handle(IPC.accountsList, () => {
    return db
      .select()
      .from(accounts)
      .orderBy(asc(accounts.institutionName), asc(accounts.name))
      .all()
  })

  ipcMain.handle(IPC.accountsGet, (_event, input: unknown) => {
    const id = accountIdSchema.parse(input)
    return db.select().from(accounts).where(eq(accounts.id, id)).get() ?? null
  })

  ipcMain.handle(IPC.accountTransactions, (_event, input: unknown) => {
    const q = accountTransactionsQuerySchema.parse(input)
    return transactionsPage(eq(transactions.accountId, q.accountId), q)
  })

  ipcMain.handle(IPC.transactionsList, (_event, input: unknown) => {
    const q = transactionsQuerySchema.parse(input)
    return transactionsPage(undefined, q)
  })
}
