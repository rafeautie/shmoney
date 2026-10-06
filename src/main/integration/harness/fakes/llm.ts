import {
  DEFAULT_MODEL_ID,
  LLM_IPC,
  LLM_MODELS,
  MODEL_IDS,
  type HardwareInfo,
  type LlmFeature,
  type LlmStatus,
  type ModelDiskSizes,
  type ModelId,
  type ModelStage
} from '@shared/llm'
import { BrowserWindow } from 'electron'
import type { llmManager as realManager } from '../../../llm/manager'

// Stands in for main/llm/manager.ts, the one seam every model feature goes
// through. A spec decides what's on disk and how each request answers; nothing
// loads a model. Starts like a fresh install: nothing downloaded.

type Manager = Pick<
  typeof realManager,
  | 'getStatus'
  | 'getDiskSizes'
  | 'getHardware'
  | 'download'
  | 'cancelDownload'
  | 'deleteModel'
  | 'selectModel'
  | 'generate'
  | 'chat'
>
type GenerateHandler = (feature: LlmFeature, prompt: string, schema?: object) => unknown
type ChatHandler = (...args: Parameters<Manager['chat']>) => ReturnType<Manager['chat']>

const notReady = (): never => {
  throw new Error('No scripted answer for this request')
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

const state = {
  status: freshStatus(),
  hardware: { totalRamBytes: 32 * 1024 ** 3 } as HardwareInfo,
  generate: notReady as GenerateHandler,
  chat: notReady as ChatHandler
}

export function sendToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}

function pushStatus(): LlmStatus {
  sendToRenderer(LLM_IPC.statusChanged, state.status)
  return state.status
}

/** what a spec scripts: disk state, RAM, and how each request answers */
export const fakeLlm = {
  setStage(stage: ModelStage, modelId: ModelId = state.status.selected): void {
    state.status.models[modelId] = { stage, error: stage === 'error' ? 'Download failed' : null }
  },
  /** the selected model is on disk and ready to answer */
  ready(): void {
    fakeLlm.setStage('downloaded')
  },
  setRam(bytes: number): void {
    state.hardware = { totalRamBytes: bytes }
  },
  onGenerate(handler: GenerateHandler): void {
    state.generate = handler
  },
  onChat(handler: ChatHandler): void {
    state.chat = handler
  }
}

export function resetFakeLlm(): void {
  state.status = freshStatus()
  state.hardware = { totalRamBytes: 32 * 1024 ** 3 }
  state.generate = notReady
  state.chat = notReady
}

// same gate as the real manager: inference needs the selected file on disk
function runnable(): void {
  const { selected, models } = state.status
  if (models[selected].stage !== 'downloaded') {
    throw new Error(`Model is not downloaded (${models[selected].stage})`)
  }
}

export const llmManager: Manager = {
  getStatus: () => state.status,
  getDiskSizes: () =>
    Object.fromEntries(
      MODEL_IDS.map((id) => [
        id,
        state.status.models[id].stage === 'downloaded' ? LLM_MODELS[id].downloadBytes : null
      ])
    ) as ModelDiskSizes,
  getHardware: () => state.hardware,
  download: async (modelId) => {
    fakeLlm.setStage('downloaded', modelId)
    state.status.selected = modelId
    return pushStatus()
  },
  cancelDownload: async (modelId) => {
    if (state.status.models[modelId].stage === 'downloading')
      fakeLlm.setStage('notDownloaded', modelId)
  },
  deleteModel: async (modelId) => {
    fakeLlm.setStage('notDownloaded', modelId)
    return pushStatus()
  },
  selectModel: async (modelId) => {
    state.status.selected = modelId
    return pushStatus()
  },
  generate: async (feature, prompt, schema, signal) => {
    runnable()
    signal?.throwIfAborted()
    return state.generate(feature, prompt, schema)
  },
  chat: async (...args) => {
    runnable()
    return state.chat(...args)
  }
}
