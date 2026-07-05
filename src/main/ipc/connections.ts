import { ipcMain, safeStorage } from 'electron'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { connections, accounts, transactions, settings, actionLog } from '../db/schema'
import type { ConnectionRow } from '../db/schema'
import { claimAccessUrl, fetchAccounts, parseAmount } from '../simplefin'
import { transactionsPage, transactionDate } from './transactions-page'
import { recordAction } from './action-log'
import { detectTransferPairs } from '../transfers'
import {
  IPC,
  connectInputSchema,
  accountIdSchema,
  type Connection,
  type SyncResult
} from '@shared/ipc'
import {
  filteredAccountTransactionsQuerySchema,
  filteredTransactionsQuerySchema
} from '@shared/transaction-filters'
import { buildWhere } from '../reports/query'

const FIRST_SYNC_WINDOW_SECONDS = 90 * 24 * 60 * 60
const RESYNC_OVERLAP_SECONDS = 7 * 24 * 60 * 60

function detectTransfersEnabled(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, 'detectTransfers')).get()
  // default on; only an explicit stored `false` disables it
  return row ? row.value !== false : true
}

function toConnection(row: ConnectionRow): Connection {
  // accessUrlEncrypted deliberately never crosses IPC
  return {
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    lastSyncErrors: row.lastSyncErrors ?? []
  }
}

// the app supports a single SimpleFIN connection; oldest row wins if legacy data has more
function connectionRow(): ConnectionRow | undefined {
  return db.select().from(connections).orderBy(asc(connections.id)).limit(1).get()
}

async function syncConnection(): Promise<SyncResult> {
  const row = connectionRow()
  if (!row) throw new Error('Not connected to SimpleFIN')

  const accessUrl = safeStorage.decryptString(Buffer.from(row.accessUrlEncrypted, 'base64'))
  const now = Math.floor(Date.now() / 1000)
  const startDate = row.lastSyncedAt
    ? row.lastSyncedAt - RESYNC_OVERLAP_SECONDS
    : now - FIRST_SYNC_WINDOW_SECONDS

  const payload = await fetchAccounts(accessUrl, startDate)
  const institutionByConnId = new Map(payload.connections.map((c) => [c.conn_id, c.name]))

  const detectEnabled = detectTransfersEnabled()

  const result = db.transaction((tx) => {
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
        // txnValues must never include categoryId or deletedAt: the upsert below
        // reuses it as the conflict `set`, and user edits/deletes live in those
        // columns — including them would wipe the edits on every sync
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

    // detect transfers over all currently-unmarked rows (cheap: bucketed by
    // amount), marking both legs and logging one 'detector' entry to undo from
    let detectedTransfers = 0
    if (detectEnabled) {
      const candidates = tx
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          amount: transactions.amount,
          date: transactionDate
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.pending, false),
            isNull(transactions.deletedAt),
            eq(transactions.isTransfer, false)
          )
        )
        .all()
      const pairs = detectTransferPairs(candidates)
      if (pairs.length > 0) {
        const ids = pairs.flat()
        tx.update(transactions).set({ isTransfer: true }).where(inArray(transactions.id, ids)).run()
        recordAction(tx, {
          source: 'detector',
          label: `Detected ${pairs.length} transfer${pairs.length === 1 ? '' : 's'}`,
          changes: ids.map((id) => ({
            transactionId: id,
            field: 'isTransfer',
            before: false,
            after: true
          }))
        })
        detectedTransfers = pairs.length
      }
    }

    // persist this sync's errlist so the connection card can surface it; a clean
    // sync writes null, clearing warnings once the underlying issue is resolved
    const lastSyncErrors =
      payload.errlist.length > 0 ? payload.errlist.map((e) => ({ code: e.code, msg: e.msg })) : null
    const [updated] = tx
      .update(connections)
      .set({ lastSyncedAt: now, lastSyncErrors })
      .where(eq(connections.id, row.id))
      .returning()
      .all()
    return { updated, detectedTransfers }
  })

  return { ...toConnection(result.updated), detectedTransfers: result.detectedTransfers }
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
    // cascades to accounts and transactions; the audit log has no FK, so clear
    // it too rather than leave entries pointing at deleted transactions
    db.delete(connections).run()
    db.delete(actionLog).run()
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
