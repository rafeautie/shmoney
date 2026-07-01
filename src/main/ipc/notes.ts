import { ipcMain } from 'electron'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { notes } from '../db/schema'
import { IPC, createNoteSchema, updateNoteSchema } from '@shared/ipc'

export function registerNotesIpc(): void {
  ipcMain.handle(IPC.notesList, () => {
    return db.select().from(notes).orderBy(desc(notes.updatedAt)).all()
  })

  ipcMain.handle(IPC.notesCreate, (_event, input: unknown) => {
    const { title, body } = createNoteSchema.parse(input)
    const [row] = db.insert(notes).values({ title, body }).returning().all()
    return row
  })

  ipcMain.handle(IPC.notesUpdate, (_event, input: unknown) => {
    const { id, title, body } = updateNoteSchema.parse(input)
    const [row] = db
      .update(notes)
      .set({ title, body, updatedAt: sql`(current_timestamp)` })
      .where(eq(notes.id, id))
      .returning()
      .all()
    return row
  })

  ipcMain.handle(IPC.notesRemove, (_event, id: unknown) => {
    const noteId = Number(id)
    db.delete(notes).where(eq(notes.id, noteId)).run()
    return true
  })
}
