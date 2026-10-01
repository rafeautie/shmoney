import { ipcMain } from 'electron'
import { z } from 'zod'
import { categorizeScopeSchema } from '@shared/ipc'
import { llmManager } from '../llm/manager'
import { categorizeTransactions, cancelCategorize } from '../llm/features/categorize'
import { getUsageSummary } from '../llm/usage'
import {
  LLM_IPC,
  modelIdSchema,
  type CategorizeResult,
  type HardwareInfo,
  type LlmStatus,
  type LlmUsageSummary,
  type ModelDiskSizes
} from '@shared/llm'

// Thin wiring only: the core model lifecycle lives in ../llm/manager and each
// feature lives under ../llm/features. Adding a feature = one file there + one
// handler line here.
export function registerLlmIpc(): void {
  ipcMain.handle(LLM_IPC.getStatus, (): LlmStatus => llmManager.getStatus())

  ipcMain.handle(LLM_IPC.getDiskSizes, (): ModelDiskSizes => llmManager.getDiskSizes())

  ipcMain.handle(LLM_IPC.getHardware, (): HardwareInfo => llmManager.getHardware())

  ipcMain.handle(LLM_IPC.download, (_event, input: unknown): Promise<LlmStatus> =>
    llmManager.download(modelIdSchema.parse(input))
  )

  ipcMain.handle(LLM_IPC.cancelDownload, (_event, input: unknown): Promise<void> =>
    llmManager.cancelDownload(modelIdSchema.parse(input))
  )

  ipcMain.handle(LLM_IPC.deleteModel, (_event, input: unknown): Promise<LlmStatus> =>
    llmManager.deleteModel(modelIdSchema.parse(input))
  )

  ipcMain.handle(LLM_IPC.selectModel, (_event, input: unknown): Promise<LlmStatus> =>
    llmManager.selectModel(modelIdSchema.parse(input))
  )

  ipcMain.handle(LLM_IPC.categorize, (_event, input: unknown): Promise<CategorizeResult> =>
    categorizeTransactions(categorizeScopeSchema.parse(input))
  )

  ipcMain.handle(LLM_IPC.cancelCategorize, (): void => cancelCategorize())

  // the renderer passes its llmUsageSince setting, so a reset counts from the
  // value it just wrote rather than racing that write
  ipcMain.handle(LLM_IPC.getUsage, (_event, since: unknown): LlmUsageSummary =>
    getUsageSummary(z.number().nullable().parse(since))
  )
}
