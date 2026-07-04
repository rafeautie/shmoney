import { ipcMain } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { savedFilters } from '../db/schema'
import { idSchema } from '@shared/ipc'
import {
  SAVED_FILTERS_IPC,
  savedFilterCreateSchema,
  savedFilterUpdateSchema,
  transactionFiltersSchema,
  type SavedFilter
} from '@shared/transaction-filters'

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function registerSavedFiltersIpc(): void {
  ipcMain.handle(SAVED_FILTERS_IPC.list, (): SavedFilter[] => {
    const rows = db.select().from(savedFilters).orderBy(asc(savedFilters.name)).all()
    // filters are stored as JSON; if a row no longer parses (schema drift),
    // drop it from the list instead of crashing the renderer
    return rows.flatMap((row) => {
      const parsed = transactionFiltersSchema.safeParse(row.filters)
      if (!parsed.success) {
        console.warn(`saved filter ${row.id} ("${row.name}") failed to parse, hiding it`)
        return []
      }
      return [{ ...row, filters: parsed.data }]
    })
  })

  ipcMain.handle(SAVED_FILTERS_IPC.create, (_event, input: unknown): SavedFilter => {
    const { name, filters } = savedFilterCreateSchema.parse(input)
    const now = nowSec()
    const [row] = db
      .insert(savedFilters)
      .values({ name, filters, createdAt: now, updatedAt: now })
      .returning()
      .all()
    return row
  })

  ipcMain.handle(SAVED_FILTERS_IPC.update, (_event, input: unknown): SavedFilter => {
    const { id, name, filters } = savedFilterUpdateSchema.parse(input)
    const [row] = db
      .update(savedFilters)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(filters !== undefined ? { filters } : {}),
        updatedAt: nowSec()
      })
      .where(eq(savedFilters.id, id))
      .returning()
      .all()
    if (!row) throw new Error(`Saved filter ${id} not found`)
    return row
  })

  ipcMain.handle(SAVED_FILTERS_IPC.delete, (_event, input: unknown): boolean => {
    const id = idSchema.parse(input)
    db.delete(savedFilters).where(eq(savedFilters.id, id)).run()
    return true
  })
}
