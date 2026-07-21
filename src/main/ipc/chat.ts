import { ipcMain } from 'electron'
import { and, eq, isNull } from 'drizzle-orm'
import {
  CHAT_IPC,
  conversationIdSchema,
  renameConversationSchema,
  sendChatSchema,
  setConversationAccountSchema,
  type Conversation,
  type ConversationMessages,
  type SendChatResult
} from '@shared/chat'
import { db } from '../db'
import { conversations } from '../db/schema'
import {
  listConversations,
  listMessages,
  purgeDeletedConversations,
  recoverAbandonedTurns,
  sendChatMessage,
  stopChat
} from '../llm/features/chat'
import { recordAction } from './action-log'

// Thin wiring only: generation lives in ../llm/features/chat; the simple
// conversation CRUD is plain drizzle right here.
export function registerChatIpc(): void {
  recoverAbandonedTurns()
  purgeDeletedConversations()

  ipcMain.handle(CHAT_IPC.listConversations, (): Conversation[] => listConversations())

  ipcMain.handle(CHAT_IPC.listMessages, (_event, input: unknown): ConversationMessages =>
    listMessages(conversationIdSchema.parse(input))
  )

  ipcMain.handle(CHAT_IPC.send, (_event, input: unknown): Promise<SendChatResult> =>
    sendChatMessage(sendChatSchema.parse(input))
  )

  ipcMain.handle(CHAT_IPC.stop, (): void => stopChat())

  // takes effect on the next turn: the in-flight one captured its scope at send
  ipcMain.handle(CHAT_IPC.setConversationAccount, (_event, input: unknown): boolean => {
    const { id, accountId } = setConversationAccountSchema.parse(input)
    const result = db
      .update(conversations)
      .set({ accountId, updatedAt: Date.now() })
      .where(eq(conversations.id, id))
      .run()
    return result.changes > 0
  })

  ipcMain.handle(CHAT_IPC.renameConversation, (_event, input: unknown): boolean => {
    const { id, title } = renameConversationSchema.parse(input)
    return db.transaction((tx) => {
      const row = tx
        .select({ title: conversations.title })
        .from(conversations)
        .where(eq(conversations.id, id))
        .get()
      if (!row || row.title === title) return false
      tx.update(conversations)
        .set({ title, updatedAt: Date.now() })
        .where(eq(conversations.id, id))
        .run()
      recordAction(tx, {
        source: 'user',
        label: 'Rename conversation',
        changes: [
          { field: 'conversationTitle', conversationId: id, before: row.title, after: title }
        ]
      })
      return true
    })
  })

  // soft delete, recorded in the action log: the row (and its messages) stay
  // put so undo — toast or Ctrl+Z — can bring the conversation back
  ipcMain.handle(CHAT_IPC.deleteConversation, (_event, input: unknown): number | null => {
    const id = conversationIdSchema.parse(input)
    const now = Date.now()
    return db.transaction((tx) => {
      const row = tx
        .select({ title: conversations.title })
        .from(conversations)
        .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)))
        .get()
      if (!row) return null
      tx.update(conversations).set({ deletedAt: now }).where(eq(conversations.id, id)).run()
      return recordAction(tx, {
        source: 'user',
        label: 'Delete conversation',
        changes: [
          {
            field: 'conversationDeletedAt',
            conversationId: id,
            title: row.title,
            before: null,
            after: now
          }
        ]
      })
    })
  })
}
