import type { ChatChunkKind, ChatToolCallEvent } from '@shared/chat'
import type { LlmDownloadProgress, LlmStatus } from '@shared/llm'
import type { ChatToolScope } from './sql-tool'
// type-only: erased at compile time, so the manager still never runtime-imports
// node-llama-cpp (the worker is the only place that does)
import type { ChatHistoryItem } from 'node-llama-cpp'

// plain `Omit` isn't distributive over unions (keyof a union is the
// intersection of its members' keys), which would collapse WorkerCommand to
// only its `type` field. This re-distributes Omit over each union member.
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

// commands the manager sends to the worker; each carries a numeric id the
// worker echoes back on its reply so concurrent calls can be correlated
export type WorkerCommand =
  | { id: number; type: 'download' }
  | { id: number; type: 'cancelDownload' }
  // remove the downloaded file from disk, disposing it first if it's loaded
  | { id: number; type: 'delete' }
  | { id: number; type: 'load' }
  | { id: number; type: 'unload' }
  // the generic inference primitive every LLM feature is built on: a prompt,
  // and an optional JSON schema that constrains decoding to that shape
  | { id: number; type: 'generate'; prompt: string; schema?: object }
  // abort the in-flight generate or chat (a generate's promise rejects; a chat
  // resolves with its partial text and interrupted=true). A separate command
  // because an AbortSignal can't cross the process boundary.
  | { id: number; type: 'abortGenerate' }
  // one conversational turn: replace the chat session's history, then stream
  // the reply to `prompt` back as chatChunk events carrying this command's id.
  // toolScope narrows what the query tool's scope views expose for this turn.
  | {
      id: number
      type: 'chat'
      history: ChatHistoryItem[]
      prompt: string
      toolScope: ChatToolScope
      // the scope's single display currency, fixed per turn by the feature
      // layer; the worker stamps it into chart display payloads so events and
      // parts carry it from the source. Kept beside toolScope rather than in
      // it: ChatToolScope belongs to the query tool's view scoping.
      currency: string | null
    }

/** a tool-call lifecycle event as it crosses the worker boundary: the shared
 * renderer event minus conversationId (the worker only knows command ids;
 * the feature layer adds the conversation when forwarding) */
export type ChatToolCallPayload = DistributiveOmit<ChatToolCallEvent, 'conversationId'>

/** reply payload of a 'chat' command: the assistant row's parts in their
 * persisted format, built in generation order by the worker's TurnLog (which
 * carries the full doc comments) so the feature layer stores them verbatim */
export type { ChatGenerationResult } from './turn-log'

// messages the worker sends back: either a reply to a specific command (by
// id) or an unsolicited push event (status/progress), which carries no id
export type WorkerMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { event: 'status'; status: LlmStatus }
  | { event: 'downloadProgress'; progress: LlmDownloadProgress }
  // streamed text of an in-flight chat, tied to its command id. `kind`
  // separates the visible answer from thought-segment text.
  | { event: 'chatChunk'; id: number; text: string; kind: ChatChunkKind }
  // lifecycle of one query tool call inside an in-flight chat, also tied to
  // the command id; callId distinguishes calls within the turn. params chunks
  // stream the argument text while the model writes it, start marks execution
  // with the parsed SQL, end carries the full (already size-capped) result.
  | ({ event: 'chatToolCall'; id: number } & ChatToolCallPayload)
