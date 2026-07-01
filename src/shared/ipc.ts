import { z } from 'zod'

export interface Note {
  id: number
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20000).default('')
})
export type CreateNoteInput = z.infer<typeof createNoteSchema>

export const updateNoteSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20000)
})
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>

export const IPC = {
  notesList: 'notes:list',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove'
} as const
