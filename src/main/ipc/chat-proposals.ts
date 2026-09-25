import { ipcMain } from 'electron'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { budgetSetFillSchema } from '@shared/budgets'
import { goalUpdateSchema } from '@shared/goals'
import {
  CHAT_IPC,
  resolveProposalSchema,
  undoProposalSchema,
  type ChatMessage,
  type ChatMessagePart,
  type ProposalDisplay,
  type ResolveProposalInput,
  type UndoProposalInput
} from '@shared/chat'
import { db } from '../db'
import { actionLog, chatMessages, transactions } from '../db/schema'
import { undoAction } from './action-log'
import { setBudgetFill } from './budgets'
import { updateGoal } from './goals'
import {
  approvedDisplay,
  deniedDisplay,
  proposalActionIds,
  proposalAt,
  proposalLabels,
  reconciledParts,
  selectedRows,
  undoneDisplay,
  unchangedSincePreview,
  withDisplay,
  type ApplyOutcome
} from './proposal-state'
import { applyCategories } from './transactions'

const toMilli = (major: number): number => Math.round(major * 1000)

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Each apply goes through the same save function the page for that record
// uses, nested in the transaction that rewrites the part, so a proposal is
// never left applied but still showing Apply.
function apply(display: ProposalDisplay, merchants: string[] | undefined, tx: Tx): ApplyOutcome {
  const p = display.proposal
  switch (p.kind) {
    case 'recategorize': {
      const rows = selectedRows(p, merchants)
      if (rows.length === 0) throw new Error('No merchants were selected')
      // rows deleted, pending or recategorized since the preview are skipped, so
      // an approval can't overwrite an edit the user made after seeing it
      const current = new Map<number, number | null>(
        tx
          .select({ id: transactions.id, categoryId: transactions.categoryId })
          .from(transactions)
          .where(
            and(
              inArray(
                transactions.id,
                rows.map((r) => r.id)
              ),
              eq(transactions.pending, false),
              isNull(transactions.deletedAt)
            )
          )
          .all()
          .map((r) => [r.id, r.categoryId])
      )
      const ids = unchangedSincePreview(rows, current)
      if (ids.length === 0) return { actionId: null, applied: 0, skipped: rows.length }
      const { changed, actionId } = applyCategories(
        {
          changes: ids.map((transactionId) => ({ transactionId, categoryId: p.toCategoryId })),
          source: 'user'
        },
        (n) => proposalLabels.recategorize(n, p.toCategory),
        tx
      )
      return { actionId, applied: changed, skipped: rows.length - changed }
    }
    case 'set_budget': {
      const actionId = setBudgetFill(
        budgetSetFillSchema.parse({
          categoryId: p.categoryId,
          month: p.month,
          amount: toMilli(p.after)
        }),
        proposalLabels.setBudget(p.category),
        tx
      )
      return { actionId, applied: actionId === null ? 0 : 1, skipped: 0 }
    }
    case 'update_goal': {
      const { actionId } = updateGoal(
        goalUpdateSchema.parse({
          id: p.goalId,
          ...(p.after.targetAmount !== p.before.targetAmount
            ? { targetAmount: toMilli(p.after.targetAmount) }
            : {}),
          ...(p.after.targetDate !== p.before.targetDate ? { targetDate: p.after.targetDate } : {}),
          ...(p.after.archived !== p.before.archived ? { archived: p.after.archived } : {})
        }),
        proposalLabels.updateGoal(p.goal, p.after.archived),
        tx
      )
      return { actionId, applied: actionId === null ? 0 : 1, skipped: 0 }
    }
  }
}

/**
 * Messages with each applied proposal's status read from the action log, so
 * a card follows Ctrl+Z/Ctrl+Y and Activity undo/redo of its entry.
 */
export function reconcileProposals<T extends { parts: ChatMessagePart[] }>(
  messages: T[],
  reader: Pick<Tx, 'select'> = db
): T[] {
  const ids = [...new Set(messages.flatMap((m) => proposalActionIds(m.parts)))]
  if (ids.length === 0) return messages
  const undoneAt = new Map(
    reader
      .select({ id: actionLog.id, undoneAt: actionLog.undoneAt })
      .from(actionLog)
      .where(inArray(actionLog.id, ids))
      .all()
      .map((r) => [r.id, r.undoneAt])
  )
  return messages.map((m) =>
    proposalActionIds(m.parts).length === 0
      ? m
      : { ...m, parts: reconciledParts(m.parts, undoneAt) }
  )
}

function loadMessage(tx: Tx, id: number): ChatMessage {
  const row = tx.select().from(chatMessages).where(eq(chatMessages.id, id)).get()
  if (!row) throw new Error(`Message ${id} not found`)
  return reconcileProposals([row], tx)[0]
}

/** Apply or dismiss the proposal at a message part; returns the updated message. */
export function resolveProposal(input: ResolveProposalInput): ChatMessage {
  return db.transaction((tx) => {
    const message = loadMessage(tx, input.messageId)
    const display = proposalAt(message.parts, input.partIndex, 'approval-requested')
    const next =
      input.decision === 'deny'
        ? deniedDisplay(display)
        : approvedDisplay(display, apply(display, input.merchants, tx))
    const parts = withDisplay(message.parts, input.partIndex, next)
    tx.update(chatMessages).set({ parts }).where(eq(chatMessages.id, message.id)).run()
    return { ...message, parts }
  })
}

/** Undo an applied proposal through the action log; returns the updated message. */
export function undoProposal(input: UndoProposalInput): ChatMessage {
  return db.transaction((tx) => {
    const message = loadMessage(tx, input.messageId)
    const display = proposalAt(message.parts, input.partIndex)
    // already undone elsewhere (Ctrl+Z, Activity): the reconciled card is the answer
    if (display.status === 'undone' && display.actionId !== null) return message
    if (display.status !== 'approved')
      throw new Error(`The proposal is ${display.status}, not approved`)
    if (display.applied === 0) throw new Error('That proposal changed nothing to undo')
    if (display.actionId === null)
      throw new Error("That change is no longer in the Activity history, so it can't be undone")
    undoAction(display.actionId, tx)
    const parts = withDisplay(message.parts, input.partIndex, undoneDisplay(display))
    tx.update(chatMessages).set({ parts }).where(eq(chatMessages.id, message.id)).run()
    return { ...message, parts }
  })
}

export function registerChatProposalsIpc(): void {
  ipcMain.handle(CHAT_IPC.resolveProposal, (_event, input: unknown): ChatMessage =>
    resolveProposal(resolveProposalSchema.parse(input))
  )
  ipcMain.handle(CHAT_IPC.undoProposal, (_event, input: unknown): ChatMessage =>
    undoProposal(undoProposalSchema.parse(input))
  )
}
