// The lifecycle of a chat proposal part, as pure functions over the stored
// parts so vitest can check it (the IPC around it needs better-sqlite3).
import {
  ACTION_TOOL_NAMES,
  type ActionToolName,
  type ChatMessagePart,
  type Proposal,
  type ProposalDisplay,
  type ProposalStatus
} from '@shared/chat'

export type ProposalPart = Extract<ChatMessagePart, { type: 'functionCall' }> & {
  name: ActionToolName
  display: ProposalDisplay | null
}

/** what an approval did: the entry to undo and the rows it changed or skipped */
export interface ApplyOutcome {
  actionId: number | null
  applied: number
  skipped: number
}

/** The proposal at parts[index], which must be in `status` when given; throws otherwise. */
export function proposalAt(
  parts: ChatMessagePart[],
  index: number,
  status?: ProposalStatus
): ProposalDisplay {
  const part = parts[index]
  if (!part || part.type !== 'functionCall')
    throw new Error(`Message part ${index} is not a tool call`)
  if (!(ACTION_TOOL_NAMES as readonly string[]).includes(part.name))
    throw new Error(`Message part ${index} is not a proposal`)
  const display = (part as ProposalPart).display
  if (!display) throw new Error('That proposal failed, so there is nothing to apply')
  if (status !== undefined && display.status !== status)
    throw new Error(`The proposal is ${display.status}, not ${status}`)
  return display
}

export function withDisplay(
  parts: ChatMessagePart[],
  index: number,
  display: ProposalDisplay
): ChatMessagePart[] {
  return parts.map((p, i) => (i === index ? ({ ...p, display } as ChatMessagePart) : p))
}

export function deniedDisplay(display: ProposalDisplay): ProposalDisplay {
  return { ...display, status: 'denied' }
}

export function approvedDisplay(display: ProposalDisplay, outcome: ApplyOutcome): ProposalDisplay {
  return { ...display, status: 'approved', ...outcome }
}

export function undoneDisplay(display: ProposalDisplay): ProposalDisplay {
  if (display.actionId === null) throw new Error('That proposal changed nothing to undo')
  return { ...display, status: 'undone' }
}

/**
 * a recategorize's rows, narrowed to the merchants left checked (all when
 * omitted), each with its preview category (undefined on older proposals)
 */
export function selectedRows(
  proposal: Extract<Proposal, { kind: 'recategorize' }>,
  merchants?: string[]
): { id: number; from: number | null | undefined }[] {
  const keep = merchants ? new Set(merchants) : null
  return proposal.groups
    .filter((g) => keep === null || keep.has(g.merchant))
    .flatMap((g) => g.transactionIds.map((id, i) => ({ id, from: g.fromCategoryIds?.[i] })))
}

export function selectedTransactionIds(
  proposal: Extract<Proposal, { kind: 'recategorize' }>,
  merchants?: string[]
): number[] {
  return selectedRows(proposal, merchants).map((r) => r.id)
}

/** the rows still in their preview category; current maps each live row to its category now */
export function unchangedSincePreview(
  rows: { id: number; from: number | null | undefined }[],
  current: Map<number, number | null>
): number[] {
  return rows
    .filter((r) => current.has(r.id) && (r.from === undefined || current.get(r.id) === r.from))
    .map((r) => r.id)
}

/**
 * Status from the action log rather than the stored part, since Ctrl+Z/Ctrl+Y
 * and the Activity page undo and redo entries without touching the chat.
 * undoneAt is the entry's undone_at, or undefined when the entry is gone
 * (purged); then the stored status stands but there is nothing left to undo.
 */
export function reconciledDisplay(
  display: ProposalDisplay,
  undoneAt: number | null | undefined
): ProposalDisplay {
  if (display.actionId === null) return display
  if (display.status !== 'approved' && display.status !== 'undone') return display
  if (undoneAt === undefined) return { ...display, actionId: null }
  return { ...display, status: undoneAt === null ? 'approved' : 'undone' }
}

function proposalPart(part: ChatMessagePart): ProposalPart | null {
  if (part.type !== 'functionCall') return null
  if (!(ACTION_TOOL_NAMES as readonly string[]).includes(part.name)) return null
  return part as ProposalPart
}

/** the action-log entries a message's applied proposals point at */
export function proposalActionIds(parts: ChatMessagePart[]): number[] {
  return parts.flatMap((p) => {
    const id = proposalPart(p)?.display?.actionId
    return id == null ? [] : [id]
  })
}

/** parts with each proposal reconciled against undoneAt by entry id (missing = purged) */
export function reconciledParts(
  parts: ChatMessagePart[],
  undoneAt: Map<number, number | null>
): ChatMessagePart[] {
  return parts.map((p) => {
    const display = proposalPart(p)?.display
    if (!display || display.actionId === null) return p
    return {
      ...p,
      display: reconciledDisplay(display, undoneAt.get(display.actionId))
    } as ChatMessagePart
  })
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Activity labels for applied proposals; they end 'from chat' so the entry says where it came from */
export const proposalLabels = {
  recategorize: (changed: number, category: string): string =>
    `Recategorized ${plural(changed, 'transaction')} to ${category} from chat`,
  // no amounts: labels show as plain text on Activity and in the undo toast, outside the blur
  setBudget: (category: string): string => `Changed ${category} budget from chat`,
  updateGoal: (goal: string, archived: boolean): string =>
    archived ? `Archived ${goal} goal from chat` : `Changed ${goal} goal from chat`
}
