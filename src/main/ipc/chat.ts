import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import {
  CHAT_IPC,
  conversationIdSchema,
  renameConversationSchema,
  sendChatSchema,
  type ChatMessage,
  type Conversation,
  type SendChatResult
} from '@shared/chat'
import { db } from '../db'
import { conversations } from '../db/schema'
import { listConversations, listMessages, sendChatMessage, stopChat } from '../llm/features/chat'

// Thin wiring only: generation lives in ../llm/features/chat; the simple
// conversation CRUD is plain drizzle right here.
export function registerChatIpc(): void {
  ipcMain.handle(CHAT_IPC.listConversations, (): Conversation[] => listConversations())

  ipcMain.handle(CHAT_IPC.listMessages, (_event, input: unknown): ChatMessage[] =>
    listMessages(conversationIdSchema.parse(input))
  )

  ipcMain.handle(CHAT_IPC.send, (_event, input: unknown): Promise<SendChatResult> =>
    sendChatMessage(sendChatSchema.parse(input))
  )

  ipcMain.handle(CHAT_IPC.stop, (): void => stopChat())

  ipcMain.handle(CHAT_IPC.renameConversation, (_event, input: unknown): boolean => {
    const { id, title } = renameConversationSchema.parse(input)
    const result = db
      .update(conversations)
      .set({ title, updatedAt: Date.now() })
      .where(eq(conversations.id, id))
      .run()
    return result.changes > 0
  })

  // soft delete: the row (and its messages) stay put for the undo toast
  ipcMain.handle(CHAT_IPC.deleteConversation, (_event, input: unknown): boolean => {
    const id = conversationIdSchema.parse(input)
    const result = db
      .update(conversations)
      .set({ deletedAt: Date.now() })
      .where(eq(conversations.id, id))
      .run()
    return result.changes > 0
  })

  ipcMain.handle(CHAT_IPC.restoreConversation, (_event, input: unknown): boolean => {
    const id = conversationIdSchema.parse(input)
    const result = db
      .update(conversations)
      .set({ deletedAt: null })
      .where(eq(conversations.id, id))
      .run()
    return result.changes > 0
  })
}
