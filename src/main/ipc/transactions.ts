import { ipcMain } from 'electron'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { categories, transactions } from '../db/schema'
import { IPC, transactionIdsSchema, transactionsSetCategoriesSchema } from '@shared/ipc'

// pending rows are excluded from every bulk action: sync drops and re-inserts
// them (their SimpleFIN ids change when they post), so any change would be lost
const notPending = eq(transactions.pending, false)

export function registerTransactionsIpc(): void {
  ipcMain.handle(IPC.transactionsSetCategories, (_event, input: unknown) => {
    const { changes } = transactionsSetCategoriesSchema.parse(input)
    const categoryIds = [
      ...new Set(changes.map((c) => c.categoryId).filter((id): id is number => id !== null))
    ]
    if (categoryIds.length > 0) {
      const found = db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, categoryIds))
        .all()
      if (found.length !== categoryIds.length) throw new Error('Category not found')
    }
    // soft-deleted rows are fair game: undo can replay a category change on a
    // row that a later (still-undone) action deleted
    return db.transaction((tx) => {
      let updated = 0
      for (const { transactionId, categoryId } of changes) {
        updated += tx
          .update(transactions)
          .set({ categoryId })
          .where(and(eq(transactions.id, transactionId), notPending))
          .run().changes
      }
      return updated
    })
  })

  ipcMain.handle(IPC.transactionsBulkDelete, (_event, input: unknown) => {
    const { transactionIds } = transactionIdsSchema.parse(input)
    const now = Math.floor(Date.now() / 1000)
    const rows = db
      .update(transactions)
      .set({ deletedAt: now })
      .where(
        and(inArray(transactions.id, transactionIds), notPending, isNull(transactions.deletedAt))
      )
      .returning({ id: transactions.id })
      .all()
    return rows.map((row) => row.id)
  })

  ipcMain.handle(IPC.transactionsRestore, (_event, input: unknown) => {
    const { transactionIds } = transactionIdsSchema.parse(input)
    const rows = db
      .update(transactions)
      .set({ deletedAt: null })
      .where(inArray(transactions.id, transactionIds))
      .returning({ id: transactions.id })
      .all()
    return rows.length
  })
}
