// Assembles one chat turn's reply directly as persisted-format parts, in
// generation order: answer text the model wrote between calls (a call's
// preamble) sits before that call's part, and each closed thought segment is
// its own reasoning part wherever it fell. Building the persisted shape here,
// at the source, means the feature layer stores the result verbatim; and
// because whitespace-only text (the formatting glue the model emits between
// tool calls) is dropped at generation time too, the persisted sequence stays
// index-aligned with the renderer's streamed sequence, which drops the same
// chunks at its source. Pure module; imports only from @shared/chat, so it
// stays testable under vitest.
import type { ChatMessagePart, ChatToolCall } from '@shared/chat'

/** reply payload of a 'chat' command (re-exported by the worker protocol) */
export interface ChatGenerationResult {
  /** the persisted parts, built in generation order by the worker; text parts
   * are never empty or whitespace-only */
  parts: ChatMessagePart[]
  /** true when the turn was aborted; parts hold whatever was generated so far */
  interrupted: boolean
}

export interface TurnLog {
  /** merge into the trailing text part, else append a new one */
  pushText(text: string): void
  pushReasoning(text: string, durationMs: number): void
  pushCall(call: ChatToolCall): void
  /**
   * Settle the turn: `fullText` is the library's complete answer text, which
   * normally already streamed chunk by chunk; if it carries a tail that never
   * streamed, the tail is appended so nothing is lost. Then whitespace-only
   * text parts are dropped (see the header comment) and the result is final.
   */
  finish(fullText: string, interrupted: boolean): ChatGenerationResult
}

export function createTurnLog(): TurnLog {
  const parts: ChatMessagePart[] = []
  const pushText = (text: string): void => {
    const last = parts[parts.length - 1]
    if (last?.type === 'text') last.text += text
    else parts.push({ type: 'text', text })
  }
  return {
    pushText,
    pushReasoning(text, durationMs): void {
      parts.push({ type: 'reasoning', text, durationMs })
    },
    pushCall(call): void {
      parts.push({ type: 'functionCall', ...call })
    },
    finish(fullText, interrupted): ChatGenerationResult {
      // chunks normally carry the whole answer; keep any tail the library
      // returned that never streamed rather than lose it
      const streamed = parts
        .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('')
      if (fullText !== streamed && fullText.startsWith(streamed))
        pushText(fullText.slice(streamed.length))
      // a bare "\n" between two consecutive tool calls is formatting glue the
      // model emits, not real preamble text; a whitespace-only part would
      // otherwise persist its own empty-looking bubble
      return {
        parts: parts.filter((p) => p.type !== 'text' || p.text.trim() !== ''),
        interrupted
      }
    }
  }
}
