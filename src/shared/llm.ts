import { z } from 'zod'

// ---------- models ----------
// The app ships two on-device models the user chooses between; adding or
// swapping a model is editing this registry. Each is a single GGUF file the app
// downloads at runtime (never bundled) and verifies against a pinned SHA-256.

export const MODEL_IDS = ['e2b', 'e4b'] as const // smallest → largest
export type ModelId = (typeof MODEL_IDS)[number]

export interface LlmModel {
  id: ModelId
  /** user-facing name, e.g. "Gemma 4 E2B" */
  label: string
  /** effective parameter count shown in the picker, e.g. "2B" */
  params: string
  /** hf: URI resolved by node-llama-cpp's model downloader */
  hfUri: string
  /** local file name the downloaded model is saved as, in the app's models dir.
   * E2B keeps its original name so files downloaded before this change stay
   * recognized without a re-download. */
  fileName: string
  /** pinned SHA-256 of the GGUF file; a downloaded file that doesn't match is
   * rejected and deleted, so a tampered upstream repo can't hand us a model */
  sha256: string
  /** exact download size in bytes (the file's git-LFS size), so the UI can show
   * a size and a progress denominator before the file exists on disk */
  downloadBytes: number
  /** context window created at load time; the model supports far more, but a
   * small window bounds KV-cache memory for short categorization prompts */
  contextSize: number
  /** minimum total system RAM to run this model at all; below it, the model is
   * shown as unsupported and its features are disabled on this machine */
  minRamBytes: number
  /** total system RAM for a comfortable experience; between min and this the
   * model runs but may be slow, and the picker says so */
  recommendedRamBytes: number
}

const GIB = 1024 ** 3

// RAM thresholds carry headroom below the round GB figure because os.totalmem()
// reports slightly less than nominal (firmware-reserved memory), so a "16 GB"
// machine reads as ~15.x GiB and must still clear the 16 GB bar. They gate a
// feature-disabling warning, so they live here as tunable data, not buried logic.
export const LLM_MODELS: Record<ModelId, LlmModel> = {
  e2b: {
    id: 'e2b',
    label: 'Gemma 4 E2B',
    params: '2B',
    hfUri: 'hf:giladgd/gemma-4-E2B-it-GGUF:Q6_K',
    fileName: 'gemma-4-E2B-it-qat.gguf',
    sha256: '42753994ab08613272606e9949cb16709abc4f6ef870ac4462337f32d16e6800',
    downloadBytes: 3_872_870_816,
    contextSize: 4096,
    minRamBytes: 7 * GIB,
    recommendedRamBytes: 15 * GIB
  },
  e4b: {
    id: 'e4b',
    label: 'Gemma 4 E4B',
    params: '4B',
    hfUri: 'hf:giladgd/gemma-4-E4B-it-GGUF:Q6_K',
    fileName: 'gemma-4-E4B-it-qat.gguf',
    sha256: 'aa3e139f4983077577594c6b6477eee05cb7c8d6c75e62dae7cf90d616b45866',
    downloadBytes: 6_272_312_768,
    contextSize: 4096,
    minRamBytes: 15 * GIB,
    recommendedRamBytes: 30 * GIB
  }
}

/** The model a fresh install falls back to before hardware is known or a choice
 * is made: the smallest, so it's the safest default. */
export const DEFAULT_MODEL_ID: ModelId = 'e2b'

export const modelIdSchema = z.enum(MODEL_IDS as unknown as [ModelId, ...ModelId[]])

// the chat feature gets its own, larger context (multi-turn conversations need
// the room; categorize/extract prompts don't), created lazily on first chat
// turn so the extra KV-cache RAM is only paid while chatting.
// 8192 was too tight once the system prompt carried the query recipes: a turn
// that retries a failed query holds the prompt plus two SQL statements and two
// capped tool results at once, and context shift can't evict a system message
// that large, so the turn died with a compression error instead of answering.
export const CHAT_CONTEXT_SIZE = 12288

// ---------- hardware ----------
// Capability is a pure function of the model registry and one number, so it
// lives here (shared, testable) and both onboarding and settings compute the
// same answer. The number itself comes from main (os.totalmem via getHardware).

export interface HardwareInfo {
  /** total physical system RAM in bytes */
  totalRamBytes: number
}

/** Can this machine run the model at all? RAM is the reliable floor for a
 * CPU-run GGUF; GPU offload only lowers the real requirement, so gating on
 * total system RAM never wrongly blocks a machine that could actually run it. */
export function modelRunnable(model: LlmModel, hw: HardwareInfo): boolean {
  return hw.totalRamBytes >= model.minRamBytes
}

/** Does the machine clear the model's comfortable-RAM bar (vs. merely running)? */
export function modelComfortable(model: LlmModel, hw: HardwareInfo): boolean {
  return hw.totalRamBytes >= model.recommendedRamBytes
}

/** True when at least the smallest model runs; when false, LLM features are
 * disabled entirely because nothing the app offers will run on this machine. */
export function llmSupported(hw: HardwareInfo): boolean {
  return MODEL_IDS.some((id) => modelRunnable(LLM_MODELS[id], hw))
}

/** The model to recommend for this hardware: the largest one it can run, so a
 * capable machine is steered to the bigger model. null when none run. */
export function recommendedModelId(hw: HardwareInfo): ModelId | null {
  // MODEL_IDS is smallest → largest, so the last runnable id is the largest
  let best: ModelId | null = null
  for (const id of MODEL_IDS) if (modelRunnable(LLM_MODELS[id], hw)) best = id
  return best
}

// ---------- status ----------
// Two independent axes: each model's own on-disk/download lifecycle, and the
// runtime state of whichever model is selected (loaded into memory).

// verifying = the post-download SHA-256 check; hashing a multi-GB file takes
// long enough that the UI must show it as its own step, not a stalled download
export type ModelStage = 'notDownloaded' | 'downloading' | 'verifying' | 'downloaded' | 'error'

export interface ModelState {
  stage: ModelStage
  /** present only when stage is 'error' (a failed download or checksum) */
  error: string | null
}

// runtime of the selected model in memory: it loads on first inference and
// unloads when idle. Separate from the file lifecycle above — a downloaded
// model is 'unloaded' until something needs it.
export type RuntimeStage = 'unloaded' | 'loading' | 'ready'

export interface LlmStatus {
  /** the model inference uses; loads on demand and is switchable by the user */
  selected: ModelId
  /** per-model download/file state, independent of which model is selected */
  models: Record<ModelId, ModelState>
  /** in-memory state of the selected model */
  runtime: RuntimeStage
  /** present only when loading the selected model failed */
  runtimeError: string | null
}

/** On-disk size of each model file in bytes, or null when it isn't downloaded. */
export type ModelDiskSizes = Record<ModelId, number | null>

export interface LlmDownloadProgress {
  modelId: ModelId
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
  getDiskSizes: 'llm:getDiskSizes',
  getHardware: 'llm:getHardware',
  download: 'llm:download',
  cancelDownload: 'llm:cancelDownload',
  deleteModel: 'llm:deleteModel',
  selectModel: 'llm:selectModel',
  categorize: 'llm:categorize',
  cancelCategorize: 'llm:cancelCategorize',
  statusChanged: 'llm:statusChanged',
  downloadProgress: 'llm:downloadProgress',
  categorizeProgress: 'llm:categorizeProgress'
} as const
