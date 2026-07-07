import type { LlmDownloadProgress, LlmStatus } from '@shared/llm'

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
  // abort the in-flight generate (its promise rejects); no-op if none running.
  // A separate command because an AbortSignal can't cross the process boundary.
  | { id: number; type: 'abortGenerate' }

// messages the worker sends back: either a reply to a specific command (by
// id) or an unsolicited push event (status/progress), which carries no id
export type WorkerMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { event: 'status'; status: LlmStatus }
  | { event: 'downloadProgress'; progress: LlmDownloadProgress }
