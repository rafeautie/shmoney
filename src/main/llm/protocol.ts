import type { StreamingChatPart } from '@shared/chat'
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
  // the reply to `prompt` back as chatPart events carrying this command's id.
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
  // one part patch of an in-flight chat, tied to its command id: the full
  // current part at `index`, straight from the worker's TurnLog (the single
  // assembler; see turn-log.ts). The feature layer adds the conversation id
  // when forwarding to the renderer.
  | { event: 'chatPart'; id: number; index: number; part: StreamingChatPart }
