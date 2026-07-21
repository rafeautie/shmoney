// The single assembler of a chat reply. The turn's parts exist here and only
// here: every mutation (answer text growing, a thought opening or closing, a
// tool call opening or settling) updates one part in place and reports it
// through onPart as a full-part patch, which is the one streaming event the
// renderer consumes — it applies parts[index] = part and renders, assembling
// nothing itself. finish() yields the exact persisted parts, so streaming and
// settled rendering can never drift.
//
// The whitespace rule lives here alone: the formatting glue the model emits
// between tool calls (a bare "\n") never opens a text part — it is buffered
// until real text arrives and discarded when a thought or call lands first —
// so no whitespace-only part ever streams or persists.
//
// Pure module; imports only from @shared/chat, so it stays testable under
// vitest.
import type { ChatMessagePart, ChatToolCall, StreamingChatPart } from '@shared/chat'

/** reply payload of a 'chat' command (re-exported by the worker protocol) */
export interface ChatGenerationResult {
  /** the persisted parts, built in generation order by the worker; text parts
   * are never empty or whitespace-only */
  parts: ChatMessagePart[]
  /** true when the turn was aborted; parts hold whatever was generated so far */
  interrupted: boolean
}

export interface TurnLog {
  /** merge answer text into the trailing text part, else open a new one */
  pushText(text: string): void
  /** merge thought text into the trailing open thought, else open a new one */
  reasoningChunk(text: string): void
  /** stamp the trailing open thought's duration; no-op when none is open */
  closeReasoning(durationMs: number): void
  /** the model started writing a call's params: show the pending card */
  openCall(name: string): void
  /**
   * The call ran: replace its pending part (or append, if none opened).
   * durationMs is its open-to-settle wall-clock, measured by the worker (the
   * clock owner), so the chain of thought can total tool time alongside thinking.
   */
  settleCall(call: ChatToolCall, durationMs: number): void
  /**
   * Settle the turn: `fullText` is the library's complete answer text, which
   * normally already streamed chunk by chunk; if it carries a tail that never
   * streamed, the tail is appended so nothing is lost. Parts still pending
   * (a call aborted mid-params) are dropped; only settled shapes persist.
   */
  finish(fullText: string, interrupted: boolean): ChatGenerationResult
}

export function createTurnLog(onPart?: (index: number, part: StreamingChatPart) => void): TurnLog {
  const parts: StreamingChatPart[] = []
  // whitespace with no text part to merge into yet; see the header comment
  let glue = ''
  // every answer chunk including glue, for finish()'s never-streamed-tail check
  let allText = ''
  const emit = (index: number): void => onPart?.(index, parts[index])

  const pushText = (text: string): void => {
    allText += text
    const last = parts[parts.length - 1]
    if (last?.type === 'text') {
      last.text += text
      emit(parts.length - 1)
      return
    }
    const whole = glue + text
    if (whole.trim() === '') {
      glue = whole
      return
    }
    glue = ''
    parts.push({ type: 'text', text: whole })
    emit(parts.length - 1)
  }

  return {
    pushText,
    reasoningChunk(text): void {
      glue = ''
      const last = parts[parts.length - 1]
      if (last?.type === 'reasoning' && last.durationMs === null) {
        last.text += text
        emit(parts.length - 1)
        return
      }
      parts.push({ type: 'reasoning', text, durationMs: null })
      emit(parts.length - 1)
    },
    closeReasoning(durationMs): void {
      const index = parts.length - 1
      const last = parts[index]
      if (last?.type === 'reasoning' && last.durationMs === null) {
        parts[index] = { type: 'reasoning', text: last.text, durationMs }
        emit(index)
      }
    },
    openCall(name): void {
      glue = ''
      parts.push({ type: 'functionCall', name })
      emit(parts.length - 1)
    },
    settleCall(call, durationMs): void {
      glue = ''
      const index = parts.length - 1
      const last = parts[index]
      const part: StreamingChatPart = { type: 'functionCall', durationMs, ...call }
      if (last?.type === 'functionCall' && last.result === undefined) {
        parts[index] = part
        emit(index)
      } else {
        parts.push(part)
        emit(parts.length - 1)
      }
    },
    finish(fullText, interrupted): ChatGenerationResult {
      // chunks normally carry the whole answer; keep any tail the library
      // returned that never streamed rather than lose it
      if (fullText !== allText && fullText.startsWith(allText))
        pushText(fullText.slice(allText.length))
      return {
        parts: parts.filter((p): p is ChatMessagePart => {
          if (p.type === 'text') return true
          if (p.type === 'reasoning') return p.durationMs !== null
          return p.result !== undefined
        }),
        interrupted
      }
    }
  }
}
