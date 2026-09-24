import {
  DEFAULT_MODEL_ID,
  LLM_MODELS,
  MODEL_IDS,
  type HardwareInfo,
  type LlmStatus,
  type ModelDiskSizes,
  type ModelId,
  type ModelState
} from '@shared/llm'
import { BrowserWindow } from './shims/electron'

// Stands in for main/llm/manager.ts, the single seam every model feature goes
// through. The models run on-device and weigh gigabytes, so the demo reports
// none downloaded; every feature already treats that as "not available yet".

export const DESKTOP_ONLY = 'Runs on-device in the shmoney desktop app.'

export function sendToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}

// screenshots show the app as it looks with a model on disk
const shot = new URLSearchParams(globalThis.location?.search).get('shot') === '1'

const models = Object.fromEntries(
  MODEL_IDS.map((id) => [
    id,
    { stage: shot && id === DEFAULT_MODEL_ID ? 'downloaded' : 'notDownloaded', error: null }
  ])
) as Record<ModelId, ModelState>

const status: LlmStatus = {
  selected: DEFAULT_MODEL_ID,
  models,
  runtime: 'unloaded',
  runtimeError: null
}

const unavailable = async (): Promise<never> => {
  throw new Error(DESKTOP_ONLY)
}

export const llmManager = {
  getStatus: (): LlmStatus => status,
  getDiskSizes: (): ModelDiskSizes =>
    Object.fromEntries(
      MODEL_IDS.map((id) => [
        id,
        models[id].stage === 'downloaded' ? LLM_MODELS[id].downloadBytes : null
      ])
    ) as ModelDiskSizes,
  // a comfortable machine, so the picker shows every model as runnable
  getHardware: (): HardwareInfo => ({ totalRamBytes: 32 * 1024 ** 3 }),
  download: unavailable,
  cancelDownload: async (): Promise<void> => {},
  deleteModel: async (): Promise<LlmStatus> => status,
  selectModel: async (modelId: ModelId): Promise<LlmStatus> => {
    status.selected = modelId
    return status
  },
  generate: unavailable,
  chat: unavailable
}
