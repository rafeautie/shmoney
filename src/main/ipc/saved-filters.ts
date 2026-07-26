import { ipcMain } from 'electron'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db'
import { createLogger } from '../logging'
import { savedFilters } from '../db/schema'
import { recordAction } from './action-log'
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

const log = createLogger('saved-filters')

/**
 * Soft-deleted presets from a prior session had their undo toast close with the
 * app, so there's no restoring them; runs once at startup, before the renderer
 * exists, and hard-deletes those rows for good. Same-session deletes stay
 * restorable since this never runs mid-session.
 */
function purgeDeletedSavedFilters(): void {
  const removed = db.delete(savedFilters).where(isNotNull(savedFilters.deletedAt)).run().changes
  if (removed > 0) log.info('saved-filters.purged-deleted', { count: removed })
}

export function registerSavedFiltersIpc(): void {
  purgeDeletedSavedFilters()

  ipcMain.handle(SAVED_FILTERS_IPC.list, (): SavedFilter[] => {
    const rows = db
      .select()
      .from(savedFilters)
      .where(isNull(savedFilters.deletedAt))
      .orderBy(asc(savedFilters.name))
      .all()
    // filters are stored as JSON; if a row no longer parses (schema drift),
    // drop it from the list instead of crashing the renderer
    return rows.flatMap((row) => {
      const parsed = transactionFiltersSchema.safeParse(row.filters)
      if (!parsed.success) {
        // id only: filter names are user-written and don't belong in logs
        log.warn('saved-filter.parse-failed', { id: row.id })
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

  // soft delete, recorded in the action log: the row stays put so undo — the
  // toast or Ctrl+Z — can bring the preset back, which is why deleting one asks
  // for no confirmation. Resolves to the entry id (null when nothing was live).
  ipcMain.handle(SAVED_FILTERS_IPC.delete, (_event, input: unknown): number | null => {
    const id = idSchema.parse(input)
    const now = nowSec()
    return db.transaction((tx) => {
      const row = tx
        .select({ name: savedFilters.name })
        .from(savedFilters)
        .where(and(eq(savedFilters.id, id), isNull(savedFilters.deletedAt)))
        .get()
      if (!row) return null
      tx.update(savedFilters).set({ deletedAt: now }).where(eq(savedFilters.id, id)).run()
      return recordAction(tx, {
        source: 'user',
        label: 'Delete saved filter',
        changes: [
          {
            field: 'savedFilterDeletedAt',
            savedFilterId: id,
            name: row.name,
            before: null,
            after: now
          }
        ]
      })
    })
  })
}
