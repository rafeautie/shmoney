import { ipcMain, safeStorage } from 'electron'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { connections, accounts, transactions } from '../db/schema'
import type { ConnectionRow } from '../db/schema'
import { claimAccessUrl, fetchAccounts, parseAmount } from '../simplefin'
import { transactionsPage } from './transactions-page'
import { IPC, connectInputSchema, accountIdSchema, type Connection } from '@shared/ipc'
import {
  filteredAccountTransactionsQuerySchema,
  filteredTransactionsQuerySchema
} from '@shared/transaction-filters'
import { buildWhere } from '../reports/query'

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
    const q = filteredAccountTransactionsQuerySchema.parse(input)
    // the page's account scope is authoritative: accountIds from a loaded
    // saved filter are ignored (the renderer strips them too)
    const filterWhere = q.filters
      ? buildWhere({ ...q.filters, accountIds: undefined }, { keepUnknownDates: true })
      : undefined
    return transactionsPage(and(eq(transactions.accountId, q.accountId), filterWhere), q)
  })

  ipcMain.handle(IPC.transactionsList, (_event, input: unknown) => {
    const q = filteredTransactionsQuerySchema.parse(input)
    return transactionsPage(
      q.filters ? buildWhere(q.filters, { keepUnknownDates: true }) : undefined,
      q
    )
  })
}
