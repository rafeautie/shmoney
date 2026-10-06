import type { ChatMessagePart } from '@shared/chat'
import {
  DEFAULT_MODEL_ID,
  LLM_IPC,
  LLM_MODELS,
  MODEL_IDS,
  type GenerationStats,
  type GenerationStopReason,
  type HardwareInfo,
  type LlmFeature,
  type LlmStatus,
  type ModelDiskSizes,
  type ModelId,
  type ModelStage
} from '@shared/llm'
import type { ChatGenerationResult } from '../../main/llm/protocol'
import { BrowserWindow } from '../shims/electron'
import { installBridge } from './bridge'

// The UI tests' stand-in for main/llm/manager.ts (vite.e2e.config.ts swaps it
// in for the demo's). Specs script it from Playwright through
// window.__shmoney.llm: what's on disk, and how each request answers. Only
// serializable data crosses from the test, so replies are described, not coded.

export const DESKTOP_ONLY = 'Runs on-device in the shmoney desktop app.'

export function sendToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}

/** one scripted chat reply */
export interface ScriptedReply {
  parts: ChatMessagePart[]
  /** pause between streamed parts, so a spec can watch the turn in flight */
  delayMs?: number
  /** stream the parts, then wait for Stop instead of finishing */
  holdUntilStop?: boolean
  /** fail the turn with this message after streaming */
  error?: string
  historyDropped?: number
}

const state = {
  status: freshStatus(),
  hardware: { totalRamBytes: 32 * 1024 ** 3 } as HardwareInfo,
  replies: [] as ScriptedReply[],
  answers: new Map<LlmFeature, unknown[]>()
}

function freshStatus(): LlmStatus {
  return {
    selected: DEFAULT_MODEL_ID,
    models: Object.fromEntries(
      MODEL_IDS.map((id) => [id, { stage: 'notDownloaded', error: null }])
    ) as LlmStatus['models'],
    runtime: 'unloaded',
    runtimeError: null
  }
}

function pushStatus(): LlmStatus {
  sendToRenderer(LLM_IPC.statusChanged, state.status)
  return state.status
}

function setStage(stage: ModelStage, modelId: ModelId = state.status.selected): void {
  state.status.models[modelId] = { stage, error: stage === 'error' ? 'Download failed' : null }
  pushStatus()
}

export const llmControl = {
  setStage,
  /** the selected model is on disk */
  ready: (): void => setStage('downloaded'),
  setRam: (bytes: number): void => {
    state.hardware = { totalRamBytes: bytes }
  },
  /** queue replies; each chat turn takes the next one */
  reply: (...replies: ScriptedReply[]): void => {
    state.replies.push(...replies)
  },
  /** queue answers to generate() calls of one feature (categorize, ruleTerm) */
  answer: (feature: LlmFeature, ...answers: unknown[]): void => {
    state.answers.set(feature, [...(state.answers.get(feature) ?? []), ...answers])
  }
}

function runnable(): ModelId {
  const { selected, models } = state.status
  if (models[selected].stage !== 'downloaded') {
    throw new Error(`Model is not downloaded (${models[selected].stage})`)
  }
  return selected
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function stats(modelId: ModelId, stopReason: GenerationStopReason | null): GenerationStats {
  return {
    modelId,
    inputTokens: 1200,
    outputTokens: 80,
    decodeTokens: 80,
    decodeMs: 2000,
    ttftMs: 400,
    prefillMs: 400,
    toolMs: 0,
    totalMs: 2400,
    loadMs: null,
    contextTokens: 1280,
    contextSize: 12288,
    stopReason
  }
}

type ChatOptions = {
  signal: AbortSignal
  onPart: (index: number, part: ChatMessagePart) => void
  onStats: (stats: GenerationStats) => void
}

export const llmManager = {
  getStatus: (): LlmStatus => state.status,
  getDiskSizes: (): ModelDiskSizes =>
    Object.fromEntries(
      MODEL_IDS.map((id) => [
        id,
        state.status.models[id].stage === 'downloaded' ? LLM_MODELS[id].downloadBytes : null
      ])
    ) as ModelDiskSizes,
  getHardware: (): HardwareInfo => state.hardware,
  download: async (modelId: ModelId): Promise<LlmStatus> => {
    state.status.selected = modelId
    setStage('downloading', modelId)
    await sleep(50)
    setStage('verifying', modelId)
    await sleep(50)
    setStage('downloaded', modelId)
    return state.status
  },
  cancelDownload: async (modelId: ModelId): Promise<void> => {
    if (state.status.models[modelId].stage === 'downloading') setStage('notDownloaded', modelId)
  },
  deleteModel: async (modelId: ModelId): Promise<LlmStatus> => {
    setStage('notDownloaded', modelId)
    return state.status
  },
  selectModel: async (modelId: ModelId): Promise<LlmStatus> => {
    state.status.selected = modelId
    return pushStatus()
  },
  generate: async (feature: LlmFeature): Promise<unknown> => {
    runnable()
    const queue = state.answers.get(feature) ?? []
    if (queue.length === 0) throw new Error(`No scripted ${feature} answer`)
    return queue.shift()
  },
  chat: async (
    _history: unknown,
    _prompt: string,
    opts: ChatOptions
  ): Promise<ChatGenerationResult> => {
    const modelId = runnable()
    const reply = state.replies.shift()
    if (!reply) throw new Error('No scripted chat reply')
    const streamed: ChatMessagePart[] = []
    for (const part of reply.parts) {
      if (opts.signal.aborted) break
      if (reply.delayMs) await sleep(reply.delayMs)
      opts.onPart(streamed.length, part)
      streamed.push(part)
      opts.onStats(stats(modelId, null))
    }
    if (reply.holdUntilStop && !opts.signal.aborted) {
      await new Promise<void>((resolve) =>
        opts.signal.addEventListener('abort', () => resolve(), { once: true })
      )
    }
    if (reply.error) throw new Error(reply.error)
    const interrupted = opts.signal.aborted
    opts.onStats(stats(modelId, interrupted ? 'aborted' : 'endOfTurn'))
    return {
      parts: streamed,
      interrupted,
      ...(reply.historyDropped === undefined ? {} : { historyDropped: reply.historyDropped })
    }
  }
}

installBridge(llmControl)
