import { ipcMain } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { categoryGroups, categories } from '../db/schema'
import { resetCategoriesToDefaults } from '../db/defaults'
import { pruneOrphanedRules } from './rules'
import {
  IPC,
  idSchema,
  categoryGroupCreateSchema,
  categoryGroupRenameSchema,
  categoryCreateSchema,
  categoryRenameSchema,
  type CategoriesList,
  type Category,
  type CategoryGroup
} from '@shared/ipc'

function listCategories(): CategoriesList {
  const groups = db.select().from(categoryGroups).orderBy(asc(categoryGroups.id)).all()
  const rows = db.select().from(categories).orderBy(asc(categories.name)).all()
  const ungrouped: Category[] = []
  const system: Category[] = []
  const byGroup = new Map<number, Category[]>()
  for (const row of rows) {
    if (row.systemKey !== null) {
      system.push(row)
      continue
    }
    if (row.groupId === null) {
      ungrouped.push(row)
      continue
    }
    const list = byGroup.get(row.groupId) ?? []
    list.push(row)
    byGroup.set(row.groupId, list)
  }
  return {
    groups: groups.map((group) => ({ ...group, categories: byGroup.get(group.id) ?? [] })),
    ungrouped,
    system
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

// system categories back built-in behavior (e.g. Transfers), so rename/delete
// must reject them rather than silently break it
function assertNotSystem(id: number): void {
  const row = db
    .select({ systemKey: categories.systemKey })
    .from(categories)
    .where(eq(categories.id, id))
    .get()
  if (row?.systemKey != null) throw new Error("System categories can't be changed")
}

export function registerCategoriesIpc(): void {
  ipcMain.handle(IPC.categoriesList, () => {
    return listCategories()
  })

  ipcMain.handle(IPC.categoriesCreateGroup, (_event, input: unknown) => {
    const { name } = categoryGroupCreateSchema.parse(input)
    try {
      const row = db.insert(categoryGroups).values({ name }).returning().get()
      return { ...row, categories: [] } satisfies CategoryGroup
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error(`A group named "${name}" already exists`)
      }
      throw error
    }
  })

  ipcMain.handle(IPC.categoriesRenameGroup, (_event, input: unknown) => {
    const { id, name } = categoryGroupRenameSchema.parse(input)
    try {
      const row = db
        .update(categoryGroups)
        .set({ name })
        .where(eq(categoryGroups.id, id))
        .returning()
        .get()
      if (!row) throw new Error('Group not found')
      return true
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error(`A group named "${name}" already exists`)
      }
      throw error
    }
  })

  ipcMain.handle(IPC.categoriesDeleteGroup, (_event, input: unknown) => {
    const id = idSchema.parse(input)
    // cascades to the group's categories; their transactions become uncategorized
    db.delete(categoryGroups).where(eq(categoryGroups.id, id)).run()
    // rules targeting any of those now-deleted categories are orphaned (no FK); drop them
    pruneOrphanedRules()
    return true
  })

  ipcMain.handle(IPC.categoriesCreate, (_event, input: unknown) => {
    const { groupId, name } = categoryCreateSchema.parse(input)
    try {
      return db.insert(categories).values({ groupId, name }).returning().get()
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error(
          groupId === null
            ? `An ungrouped category named "${name}" already exists`
            : `A category named "${name}" already exists in this group`
        )
      }
      throw error
    }
  })

  ipcMain.handle(IPC.categoriesRename, (_event, input: unknown) => {
    const { id, name } = categoryRenameSchema.parse(input)
    assertNotSystem(id)
    try {
      const row = db.update(categories).set({ name }).where(eq(categories.id, id)).returning().get()
      if (!row) throw new Error('Category not found')
      return true
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error(`A category named "${name}" already exists in this group`)
      }
      throw error
    }
  })

  ipcMain.handle(IPC.categoriesDelete, (_event, input: unknown) => {
    const id = idSchema.parse(input)
    assertNotSystem(id)
    // FK sets assigned transactions' category to null
    db.delete(categories).where(eq(categories.id, id)).run()
    // a rule that targeted this category is now orphaned (no FK); drop it
    pruneOrphanedRules()
    return true
  })

  ipcMain.handle(IPC.categoriesResetDefaults, () => {
    resetCategoriesToDefaults()
    // reset replaces every user category with fresh ids, so any rule that
    // targeted an old one is now orphaned; drop those (runs outside the reset
    // transaction so it doesn't nest)
    pruneOrphanedRules()
    return listCategories()
  })
}
