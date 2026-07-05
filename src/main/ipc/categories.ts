import { ipcMain } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { categoryGroups, categories } from '../db/schema'
import { resetCategoriesToDefaults } from '../db/defaults'
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
  const byGroup = new Map<number, Category[]>()
  for (const row of rows) {
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
    ungrouped
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
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
    // FK sets assigned transactions' category to null
    db.delete(categories).where(eq(categories.id, id)).run()
    return true
  })

  ipcMain.handle(IPC.categoriesResetDefaults, () => {
    resetCategoriesToDefaults()
    return listCategories()
  })
}
