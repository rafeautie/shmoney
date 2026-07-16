import type { LlmDownloadProgress, LlmStatus } from '@shared/llm'
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
  // the reply to `prompt` back as chatChunk events carrying this command's id
  | { id: number; type: 'chat'; history: ChatHistoryItem[]; prompt: string }

/** reply payload of a 'chat' command */
export interface ChatGenerationResult {
  text: string
  /** true when the turn was aborted; text holds whatever was generated so far */
  interrupted: boolean
}

// messages the worker sends back: either a reply to a specific command (by
// id) or an unsolicited push event (status/progress), which carries no id
export type WorkerMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { event: 'status'; status: LlmStatus }
  | { event: 'downloadProgress'; progress: LlmDownloadProgress }
  // streamed text of an in-flight chat; the only push event tied to a command id
  | { event: 'chatChunk'; id: number; text: string }
