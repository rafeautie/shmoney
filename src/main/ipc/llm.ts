import { ipcMain } from 'electron'
import { categorizeScopeSchema } from '@shared/ipc'
import { llmManager } from '../llm/manager'
import { categorizeTransactions, cancelCategorize } from '../llm/features/categorize'
import { LLM_IPC, type CategorizeResult, type LlmStatus } from '@shared/llm'

// Thin wiring only: the core model lifecycle lives in ../llm/manager and each
// feature lives under ../llm/features. Adding a feature = one file there + one
// handler line here.
export function registerLlmIpc(): void {
  ipcMain.handle(LLM_IPC.getStatus, (): LlmStatus => llmManager.getStatus())

  ipcMain.handle(LLM_IPC.getDiskSize, (): number | null => llmManager.getDiskSize())

  ipcMain.handle(LLM_IPC.download, (): Promise<LlmStatus> => llmManager.download())

  ipcMain.handle(LLM_IPC.cancelDownload, (): Promise<void> => llmManager.cancelDownload())

  ipcMain.handle(LLM_IPC.deleteModel, (): Promise<LlmStatus> => llmManager.deleteModel())

  ipcMain.handle(LLM_IPC.categorize, (_event, input: unknown): Promise<CategorizeResult> =>
    categorizeTransactions(categorizeScopeSchema.parse(input))
  )

  ipcMain.handle(LLM_IPC.cancelCategorize, (): void => cancelCategorize())
}
