import type { ChatHistoryItem, ChatModelResponse } from 'node-llama-cpp'

/**
 * What a history costs in the context, in real tokens, tool descriptions
 * included. node-llama-cpp's default shift strategy measures without the tool
 * docs, so it "fits" a history that then overflows; everything here measures
 * through this instead.
 */
export type MeasureTokens = (history: ChatHistoryItem[]) => number

const EXPIRED_NOTE = 'Rows dropped to fit the context; run the tool again if you need them.'

/** index of the last user item: everything after it is the turn being generated */
export function currentTurnStart(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 1; i--) if (history[i].type === 'user') return i
  return history.length
}

/**
 * How many items after the system message to drop so the replayed history plus
 * the new prompt fits the budget. Cuts only at turn boundaries (a user item) so
 * the model never sees a reply without its question, and binary-searches since
 * fewer turns never cost more tokens.
 */
export function fitHistory(
  history: ChatHistoryItem[],
  prompt: string,
  measure: MeasureTokens,
  budget: number
): number {
  const starts = [1]
  for (let i = 2; i < history.length; i++) if (history[i].type === 'user') starts.push(i)
  starts.push(history.length)
  const fits = (start: number): boolean =>
    measure([
      history[0],
      ...history.slice(start),
      { type: 'user', text: prompt },
      { type: 'model', response: [] }
    ]) <= budget
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (fits(starts[mid])) hi = mid
    else lo = mid + 1
  }
  return starts[lo] - 1
}

/** a tool result with its rows swapped for a count; its facts and notes stay */
function expireRows(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !Array.isArray((result as { rows?: unknown }).rows))
    return result
  const { rows, columns: _columns, ...rest } = result as { rows: unknown[]; columns?: unknown }
  return {
    ...rest,
    rowCount: (rest as { rowCount?: number }).rowCount ?? rows.length,
    note: EXPIRED_NOTE
  }
}

/**
 * The chat's context-shift strategy, run by node-llama-cpp whenever the context
 * fills mid-turn. Gives up the least useful context first: older turns whole,
 * then the rows of this turn's earlier tool results (the newest stays intact;
 * the chart tool draws from the worker's state, not from history), then this
 * turn's finished thoughts. Whatever still doesn't fit falls through to the
 * library's default strategy.
 */
export function shiftHistory(
  chatHistory: readonly ChatHistoryItem[],
  measure: MeasureTokens,
  maxTokens: number
): ChatHistoryItem[] {
  let history = chatHistory.slice()
  const fits = (): boolean => measure(history) <= maxTokens
  if (fits()) return history

  // older turns, oldest first
  for (let turn = currentTurnStart(history); turn > 1; turn = currentTurnStart(history)) {
    let end = 2
    while (end < turn && history[end].type !== 'user') end++
    history = [history[0], ...history.slice(end)]
    if (fits()) return history
  }

  const last = history.length - 1
  if (history[last]?.type !== 'model') return history
  const response = [...(history[last] as ChatModelResponse).response]
  const replace = (): void => {
    history = [...history.slice(0, last), { type: 'model', response: [...response] }]
  }

  const newestCall = response.findLastIndex(
    (item) => typeof item !== 'string' && item.type === 'functionCall'
  )
  for (let i = 0; i < newestCall; i++) {
    const item = response[i]
    if (typeof item === 'string' || item.type !== 'functionCall') continue
    const result = expireRows(item.result)
    if (result === item.result) continue
    response[i] = { ...item, result }
    replace()
    if (fits()) return history
  }

  // finished thoughts, oldest first; the item being generated stays whole
  for (let i = 0; i < response.length - 1; i++) {
    const item = response[i]
    if (typeof item === 'string' || item.type !== 'segment' || !item.ended) continue
    response.splice(i--, 1)
    replace()
    if (fits()) return history
  }
  return history
}
