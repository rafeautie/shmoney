import { z } from 'zod'

// ---------- models ----------
// The on-device models the user chooses between; adding or swapping a model is
// editing MODEL_SPECS. Each is a single GGUF file the app downloads at runtime
// (never bundled) and verifies against a pinned SHA-256.

/** Which chat format the worker drives the model with; each family has its own
 * prompt layout, tool-call syntax and reasoning switch. */
export type ModelFamily = 'gemma4' | 'qwen35'

/** How the picker heads each family's group, in display order. */
export const MODEL_FAMILIES: Record<ModelFamily, { label: string; vendor: string }> = {
  gemma4: { label: 'Gemma 4', vendor: 'Google' },
  qwen35: { label: 'Qwen3.5', vendor: 'Alibaba' }
}

const GIB = 1024 ** 3

// minRamBytes: below it the model is shown as unsupported and its features are
// disabled. recommendedRamBytes: between min and this it runs but may be slow.
// Both sit below the round GB figure because os.totalmem() reports slightly
// less than nominal, so a "16 GB" machine reads as ~15.x GiB.
const RAM_TIERS = {
  small: { minRamBytes: 7 * GIB, recommendedRamBytes: 15 * GIB },
  large: { minRamBytes: 15 * GIB, recommendedRamBytes: 30 * GIB }
}

interface ModelSpec {
  family: ModelFamily
  /** name within its family, e.g. "E2B"; the label is family + variant */
  variant: string
  /** hf: URI of the exact GGUF file, resolved by node-llama-cpp's downloader */
  hfUri: string
  /** local file name override; defaults to the URI's file name */
  fileName?: string
  /** pinned SHA-256 of the GGUF file; a downloaded file that doesn't match is
   * rejected and deleted, so a tampered upstream repo can't hand us a model */
  sha256: string
  /** exact download size in bytes (the file's git-LFS size), so the UI can show
   * a size and a progress denominator before the file exists on disk */
  downloadBytes: number
  ram: keyof typeof RAM_TIERS
}

// smallest → largest download. e2b/e4b predate the other ids and keep their
// ids and -qat file names, because the selection persists by id and existing
// installs already hold files under those names.
const MODEL_SPECS = {
  'qwen35-2b': {
    family: 'qwen35',
    variant: '2B',
    hfUri: 'hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q6_K.gguf',
    sha256: 'fc90339420b4298887aafb307a4291c55440b730133bbffe6ba9630503dcb548',
    downloadBytes: 1_574_961_408,
    ram: 'small'
  },
  'qwen35-4b': {
    family: 'qwen35',
    variant: '4B',
    hfUri: 'hf:unsloth/Qwen3.5-4B-GGUF/Qwen3.5-4B-Q6_K.gguf',
    sha256: 'fdedd781c9ce676ab66b018ca247ff78e8a33c98098a822c1e2d5075e7718f66',
    downloadBytes: 3_525_956_768,
    ram: 'small'
  },
  e2b: {
    family: 'gemma4',
    variant: 'E2B',
    hfUri: 'hf:giladgd/gemma-4-E2B-it-GGUF/gemma-4-E2B-it.Q6_K.gguf',
    fileName: 'gemma-4-E2B-it-qat.gguf',
    sha256: '42753994ab08613272606e9949cb16709abc4f6ef870ac4462337f32d16e6800',
    downloadBytes: 3_872_870_816,
    ram: 'small'
  },
  // 9B and 12B ship at Q4_K_M rather than Q6_K to keep the download near E4B's
  'qwen35-9b': {
    family: 'qwen35',
    variant: '9B',
    hfUri: 'hf:unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf',
    sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
    downloadBytes: 5_680_522_464,
    ram: 'large'
  },
  e4b: {
    family: 'gemma4',
    variant: 'E4B',
    hfUri: 'hf:giladgd/gemma-4-E4B-it-GGUF/gemma-4-E4B-it.Q6_K.gguf',
    fileName: 'gemma-4-E4B-it-qat.gguf',
    sha256: 'aa3e139f4983077577594c6b6477eee05cb7c8d6c75e62dae7cf90d616b45866',
    downloadBytes: 6_272_312_768,
    ram: 'large'
  },
  'gemma4-12b': {
    family: 'gemma4',
    variant: '12B',
    hfUri: 'hf:giladgd/gemma-4-12B-it-GGUF/gemma-4-12B-it.Q4_K_M.gguf',
    sha256: '3ee029a0437c2df358f4fd789e2063d9dea7155735d66bace416ae590052f212',
    downloadBytes: 7_381_382_336,
    ram: 'large'
  }
} satisfies Record<string, ModelSpec>

export type ModelId = keyof typeof MODEL_SPECS
export const MODEL_IDS = Object.keys(MODEL_SPECS) as ModelId[]

export interface LlmModel extends Omit<ModelSpec, 'fileName' | 'ram'> {
  id: ModelId
  /** user-facing name, e.g. "Gemma 4 E2B" */
  label: string
  /** local file name the downloaded model is saved as, in the app's models dir */
  fileName: string
  minRamBytes: number
  recommendedRamBytes: number
}

export const LLM_MODELS = Object.fromEntries(
  MODEL_IDS.map((id) => {
    const { fileName, ram, ...spec }: ModelSpec = MODEL_SPECS[id]
    const model: LlmModel = {
      ...spec,
      ...RAM_TIERS[ram],
      id,
      label: `${MODEL_FAMILIES[spec.family].label} ${spec.variant}`,
      fileName: fileName ?? spec.hfUri.slice(spec.hfUri.lastIndexOf('/') + 1)
    }
    return [id, model]
  })
) as Record<ModelId, LlmModel>

/** The model a fresh install falls back to before hardware is known or a choice
 * is made: the smallest vetted one, so it's the safest default. */
export const DEFAULT_MODEL_ID: ModelId = 'qwen35-4b'

// Models the chat and categorize battery has passed, best first. The picker
// recommends the first one a machine can run, so a model only becomes the
// default suggestion once it is proven here, not because it is the largest.
// Qwen3.5 2B stays out: it overflowed the chat context and dropped amount tags.
export const RECOMMENDATION_ORDER: readonly ModelId[] = ['qwen35-9b', 'qwen35-4b', 'e4b', 'e2b']

// the generate (categorize/extract) context: the models support far more, but
// a small window bounds KV-cache memory for short prompts
export const GENERATE_CONTEXT_SIZE = 4096

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

/** The model to recommend for this hardware: the best vetted one it can run.
 * null when none run. */
export function recommendedModelId(hw: HardwareInfo): ModelId | null {
  return RECOMMENDATION_ORDER.find((id) => modelRunnable(LLM_MODELS[id], hw)) ?? null
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
