// ---------- model ----------
// the single local model the app uses; switching models is editing this object

export interface LlmModel {
  label: string
  /** hf: URI resolved by node-llama-cpp's model downloader */
  hfUri: string
  /** local file name the downloaded model is saved as, in the app's models dir */
  fileName: string
  /** pinned SHA-256 of the GGUF file; a downloaded file that doesn't match is
   * rejected and deleted, so a tampered upstream repo can't hand us a model */
  sha256: string
  /** context window created at load time; the model supports far more, but a
   * small window bounds KV-cache memory for short categorization prompts */
  contextSize: number
}

export const LLM_MODEL: LlmModel = {
  label: 'Gemma 4 E2B',
  hfUri: 'hf:giladgd/gemma-4-E2B-it-GGUF:Q6_K',
  fileName: 'gemma-4-E2B-it-qat.gguf',
  sha256: '42753994ab08613272606e9949cb16709abc4f6ef870ac4462337f32d16e6800',
  contextSize: 4096
}

// ---------- status ----------

export type LlmStage =
  'notDownloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error'

export interface LlmStatus {
  stage: LlmStage
  /** present only when stage is 'error' */
  error: string | null
}

export interface LlmDownloadProgress {
  downloadedBytes: number
  totalBytes: number
}

// ---------- categorize feature ----------

export interface CategorizeResult {
  /** transactions that received a category */
  categorized: number
  /** true when the run was cancelled before finishing (any partial results still applied) */
  cancelled: boolean
}

/** Progress while categorizing: transactions are processed one at a time. */
export interface CategorizeProgress {
  processed: number
  total: number
}

// ---------- IPC ----------

// load/unload are deliberately absent: the core loads on first generate and
// unloads itself when idle, so no feature or UI has to drive the model lifecycle
export const LLM_IPC = {
  getStatus: 'llm:getStatus',
  getDiskSize: 'llm:getDiskSize',
  download: 'llm:download',
  cancelDownload: 'llm:cancelDownload',
  deleteModel: 'llm:deleteModel',
  categorize: 'llm:categorize',
  cancelCategorize: 'llm:cancelCategorize',
  statusChanged: 'llm:statusChanged',
  downloadProgress: 'llm:downloadProgress',
  categorizeProgress: 'llm:categorizeProgress'
} as const
