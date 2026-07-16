import { ipcMain, safeStorage } from 'electron'
import { and, asc, count, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '../db'
import {
  connections,
  accounts,
  categories,
  holdings,
  transactions,
  settings,
  actionLog
} from '../db/schema'
import type { ConnectionRow } from '../db/schema'
import { claimAccessUrl, fetchAccounts, parseAmount } from '../simplefin'
import { transactionsPage, transactionDate } from './transactions-page'
import { recordAction } from './action-log'
import { applyRulesInTx } from './rules'
import { detectTransferPairs, TRANSFER_WINDOW_SECONDS } from '../transfers'
import {
  IPC,
  connectInputSchema,
  accountIdSchema,
  setInvertBalanceInputSchema,
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

export function detectTransfersEnabled(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, 'detectTransfers')).get()
  // default on; only an explicit stored `false` disables it
  return row ? row.value !== false : true
}

export function applyRulesOnSyncEnabled(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, 'applyRulesOnSync')).get()
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

// the drizzle transaction handle passed to db.transaction() callbacks
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// detect transfers (cheap: bucketed by amount) and file them under the
// Transfers system category. Only uncategorized rows are candidates to flip
// — a category the user set is never overwritten — but legs already in
// Transfers still join the candidate pool, so a leg the user marked by hand
// in an earlier sync completes when its partner shows up now. One 'detector'
// entry is logged to undo from. Shared by sync and file import; callers gate
// on detectTransfersEnabled(). Returns the number of pairs detected.
export function detectAndMarkTransfersInTx(tx: Tx): number {
  const transfersCategoryId = tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.systemKey, 'transfers'))
    .get()?.id
  if (transfersCategoryId === undefined) return 0

  const candidateColumns = {
    id: transactions.id,
    accountId: transactions.accountId,
    amount: transactions.amount,
    date: transactionDate
  }
  const unmarked = tx
    .select(candidateColumns)
    .from(transactions)
    .where(
      and(
        eq(transactions.pending, false),
        isNull(transactions.deletedAt),
        isNull(transactions.categoryId)
      )
    )
    .all()
  if (unmarked.length === 0) return 0

  // a marked leg can only pair with an unmarked one within the window, so
  // only pull marked rows near the unmarked date range — keeps this bounded
  // as transfer history accumulates rather than re-scanning every past leg
  let minDate = Infinity
  let maxDate = -Infinity
  for (const r of unmarked) {
    if (r.date < minDate) minDate = r.date
    if (r.date > maxDate) maxDate = r.date
  }
  const marked = tx
    .select(candidateColumns)
    .from(transactions)
    .where(
      and(
        eq(transactions.pending, false),
        isNull(transactions.deletedAt),
        eq(transactions.categoryId, transfersCategoryId),
        gte(transactionDate, minDate - TRANSFER_WINDOW_SECONDS),
        lte(transactionDate, maxDate + TRANSFER_WINDOW_SECONDS)
      )
    )
    .all()

  const candidates = [
    ...unmarked.map((r) => ({ ...r, isTransfer: false })),
    ...marked.map((r) => ({ ...r, isTransfer: true }))
  ]
  const pairs = detectTransferPairs(candidates)
  const ids = pairs.flatMap((p) => p.toMark)
  if (ids.length === 0) return 0

  tx.update(transactions)
    .set({ categoryId: transfersCategoryId })
    .where(inArray(transactions.id, ids))
    .run()
  recordAction(tx, {
    source: 'detector',
    label: `Detected ${pairs.length} transfer${pairs.length === 1 ? '' : 's'}`,
    changes: ids.map((id) => ({
      transactionId: id,
      field: 'categoryId',
      before: null,
      after: transfersCategoryId
    }))
  })
  return pairs.length
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
  const rulesEnabled = applyRulesOnSyncEnabled()

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

      // holdings carry no user-owned columns, so replace the whole set per account:
      // this also drops positions the account no longer reports (e.g. sold)
      tx.delete(holdings).where(eq(holdings.accountId, accountRow.id)).run()
      for (const holding of account.holdings) {
        tx.insert(holdings)
          .values({
            accountId: accountRow.id,
            simplefinId: holding.id,
            symbol: holding.symbol,
            description: holding.description,
            currency: holding.currency,
            shares: holding.shares,
            marketValue: parseAmount(holding.market_value),
            costBasis: parseAmount(holding.cost_basis),
            purchasePrice: parseAmount(holding.purchase_price),
            createdAt: holding.created
          })
          .run()
      }
    }

    const detectedTransfers = detectEnabled ? detectAndMarkTransfersInTx(tx) : 0

    // apply user rules over what's left. The detector runs first (structural,
    // high-confidence pairs); rules fill the remaining untouched rows. Like the
    // detector, each firing rule logs its own action_log entry, so it's undoable.
    let rulesApplied = 0
    if (rulesEnabled) {
      rulesApplied = applyRulesInTx(tx).categorized
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
    return { updated, detectedTransfers, rulesApplied }
  })

  return {
    ...toConnection(result.updated),
    detectedTransfers: result.detectedTransfers,
    rulesApplied: result.rulesApplied
  }
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
    // it too rather than leave entries pointing at deleted transactions. Rule
    // suggestions stay: manual-account clusters remain valid, and listing hides
    // any whose transactions are now gone
    db.delete(connections).run()
    db.delete(actionLog).run()
    return true
  })

  // stored balances stay raw as synced; the invert override is applied here at
  // read time so every consumer (detail page, list, net worth) sees the fix
  function applyInvert<
    T extends { invertBalance: boolean; balance: number; availableBalance: number | null }
  >(a: T): T {
    if (!a.invertBalance) return a
    return {
      ...a,
      balance: -a.balance,
      availableBalance: a.availableBalance === null ? null : -a.availableBalance
    }
  }

  ipcMain.handle(IPC.accountsList, () => {
    const counts = new Map(
      db
        .select({ accountId: holdings.accountId, n: count() })
        .from(holdings)
        .groupBy(holdings.accountId)
        .all()
        .map((r) => [r.accountId, r.n])
    )
    return db
      .select()
      .from(accounts)
      .orderBy(asc(accounts.institutionName), asc(accounts.name))
      .all()
      .map((a) => applyInvert({ ...a, holdingsCount: counts.get(a.id) ?? 0 }))
  })

  ipcMain.handle(IPC.accountsGet, (_event, input: unknown) => {
    const id = accountIdSchema.parse(input)
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get()
    if (!row) return null
    const c = db.select({ n: count() }).from(holdings).where(eq(holdings.accountId, id)).get()
    return applyInvert({ ...row, holdingsCount: c?.n ?? 0 })
  })

  ipcMain.handle(IPC.accountsSetInvertBalance, (_event, input: unknown) => {
    const { accountId, invertBalance } = setInvertBalanceInputSchema.parse(input)
    db.update(accounts).set({ invertBalance }).where(eq(accounts.id, accountId)).run()
    return true
  })

  ipcMain.handle(IPC.accountsDelete, (_event, input: unknown) => {
    const id = accountIdSchema.parse(input)
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get()
    if (!row) throw new Error('Account not found')
    // a synced account would just be recreated by the next sync's upsert;
    // those are removed by disconnecting SimpleFIN instead
    if (row.connectionId !== null) throw new Error('Only manual accounts can be deleted')
    // cascades to transactions and holdings; action_log entries pointing at the
    // deleted transactions are safe — undo/redo's guarded writes no-op on missing rows
    db.delete(accounts).where(eq(accounts.id, id)).run()
    return true
  })

  ipcMain.handle(IPC.accountHoldings, (_event, input: unknown) => {
    const id = accountIdSchema.parse(input)
    return db
      .select()
      .from(holdings)
      .where(eq(holdings.accountId, id))
      .orderBy(desc(holdings.marketValue))
      .all()
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
