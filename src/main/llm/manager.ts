import fs from 'node:fs'
import path from 'node:path'
import { app, utilityProcess, BrowserWindow, type UtilityProcess } from 'electron'
import { eq } from 'drizzle-orm'
import type { StreamingChatPart } from '@shared/chat'
import {
  DEFAULT_MODEL_ID,
  LLM_IPC,
  LLM_MODELS,
  MODEL_IDS,
  modelIdSchema,
  modelRunnable,
  recommendedModelId,
  type HardwareInfo,
  type LlmStatus,
  type ModelDiskSizes,
  type ModelId,
  type ModelState
} from '@shared/llm'
import { db, dbPath } from '../db'
import { settings } from '../db/schema'
import { createLogger } from '../logging'
import { getHardwareInfo } from './hardware'
import type {
  ChatGenerationResult,
  DistributiveOmit,
  WorkerCommand,
  WorkerMessage
} from './protocol'
import type { ChatToolScope } from './sql-tool'
import type { ChatHistoryItem } from 'node-llama-cpp'

const log = createLogger('llm')

function modelsDir(): string {
  return path.join(app.getPath('userData'), 'models')
}

function workerEntry(): string {
  return path.join(__dirname, 'llm/worker.js')
}

// push an unsolicited event to the renderer (status, progress). Shared so
// features can report their own progress through the same one-liner.
export function sendToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}

// after the last generate finishes, keep the model in memory this long in case
// another request follows, then unload to give its RAM back
const IDLE_UNLOAD_MS = 60_000

// streamed part patches arrive faster than the UI needs paints; coalesce to
// the latest patch per index so a 20-60 tok/s stream costs ~20 IPC messages a
// second instead of hundreds
const PART_FLUSH_MS = 50

// where the user's model choice persists: a row in the generic settings KV
// table, owned by this manager rather than the zod settings schema, since
// selection is part of the LLM status (not a standalone preference the settings
// page reads). settings:getAll skips keys it doesn't know, so this stays inert
// to the rest of the settings system.
const SELECTED_MODEL_KEY = 'selectedModel'

class LlmManager {
  private worker: UtilityProcess | null = null
  private status: LlmStatus | null = null
  // which model is currently in memory, so an inference for a different
  // selection triggers a swap and idle-unload bookkeeping targets the right one
  private loadedModelId: ModelId | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  // chat streaming: chatPart patches route to their command's handler by id
  private chatHandlers = new Map<number, (index: number, part: StreamingChatPart) => void>()
  private inFlight = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  getStatus(): LlmStatus {
    if (!this.status) this.status = this.computeInitialStatus()
    return this.status
  }

  /** On-disk size of each model file in bytes, or null when it isn't downloaded. */
  getDiskSizes(): ModelDiskSizes {
    const sizes = {} as ModelDiskSizes
    for (const id of MODEL_IDS) {
      try {
        sizes[id] = fs.statSync(path.join(modelsDir(), LLM_MODELS[id].fileName)).size
      } catch {
        sizes[id] = null
      }
    }
    return sizes
  }

  /** System hardware the picker gates model choices on (total RAM). */
  getHardware(): HardwareInfo {
    return getHardwareInfo()
  }

  private computeInitialStatus(): LlmStatus {
    const models = {} as Record<ModelId, ModelState>
    for (const id of MODEL_IDS) {
      const downloaded = fs.existsSync(path.join(modelsDir(), LLM_MODELS[id].fileName))
      models[id] = { stage: downloaded ? 'downloaded' : 'notDownloaded', error: null }
    }
    return { selected: this.readSelected(), models, runtime: 'unloaded', runtimeError: null }
  }

  private readSelected(): ModelId {
    try {
      const row = db.select().from(settings).where(eq(settings.key, SELECTED_MODEL_KEY)).get()
      const parsed = modelIdSchema.safeParse(row?.value)
      if (parsed.success) return parsed.data
    } catch (err) {
      log.warn('selectedModel.read-failed', { error: String(err) })
    }
    // No persisted choice yet. Prefer a model already on disk (the largest the
    // machine can run) so an install that downloaded one before this change
    // isn't stranded on an un-downloaded selection; otherwise fall back to the
    // hardware recommendation so a fresh install downloads the right one.
    const hw = getHardwareInfo()
    const downloaded = MODEL_IDS.filter((id) =>
      fs.existsSync(path.join(modelsDir(), LLM_MODELS[id].fileName))
    )
    const runnable = downloaded.filter((id) => modelRunnable(LLM_MODELS[id], hw))
    const pool = runnable.length ? runnable : downloaded
    if (pool.length) return pool[pool.length - 1]
    return recommendedModelId(hw) ?? DEFAULT_MODEL_ID
  }

  private persistSelected(id: ModelId): void {
    db.insert(settings)
      .values({ key: SELECTED_MODEL_KEY, value: id })
      .onConflictDoUpdate({ target: settings.key, set: { value: id } })
      .run()
  }

  private pushStatus(): void {
    sendToRenderer(LLM_IPC.statusChanged, this.getStatus())
  }

  async download(modelId: ModelId): Promise<LlmStatus> {
    await this.send({ type: 'download', modelId })
    return this.getStatus()
  }

  async cancelDownload(modelId: ModelId): Promise<void> {
    await this.send({ type: 'cancelDownload', modelId })
  }

  private async load(modelId: ModelId): Promise<void> {
    await this.send({ type: 'load', modelId })
  }

  private async unload(): Promise<void> {
    await this.send({ type: 'unload' })
  }

  /** Delete a downloaded model file, unloading it first if it's the one loaded. */
  async deleteModel(modelId: ModelId): Promise<LlmStatus> {
    if (this.loadedModelId === modelId) this.clearIdleTimer()
    await this.send({ type: 'delete', modelId })
    return this.getStatus()
  }

  /**
   * Switch which model inference uses. Persists the choice and, if a different
   * model is currently loaded, unloads it so the next request loads the new
   * selection — one model in memory at a time. A no-op when already selected.
   */
  async selectModel(modelId: ModelId): Promise<LlmStatus> {
    const status = this.getStatus()
    if (status.selected === modelId) return status
    this.persistSelected(modelId)
    status.selected = modelId
    status.runtimeError = null
    if (this.loadedModelId !== null && this.loadedModelId !== modelId) {
      this.clearIdleTimer()
      // optimistic so the badge doesn't flash the old model as ready; the
      // worker's runtime event confirms and clears loadedModelId
      status.runtime = 'unloaded'
      void this.unload()
    }
    this.pushStatus()
    return this.getStatus()
  }

  /**
   * Model lifecycle shared by every inference request: ensure the selected
   * model is the one loaded (loading or swapping as needed), relay `signal` as
   * an abort command (an AbortSignal can't cross to the worker), and count the
   * request toward idle unload — once requests stop, the model is unloaded
   * after {@link IDLE_UNLOAD_MS} to give its RAM back. Features never load or
   * unload themselves.
   */
  private async withModel<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    this.clearIdleTimer()
    const status = this.getStatus()
    const selected = status.selected
    if (status.models[selected].stage !== 'downloaded') {
      throw new Error(`Model is not downloaded (${status.models[selected].stage})`)
    }
    // load the selected model, or swap to it if a different one is in memory;
    // load() is a no-op inside the worker when it's already the loaded model
    if (this.loadedModelId !== selected) {
      await this.load(selected)
      this.loadedModelId = selected
    }
    const onAbort = (): void => void this.send({ type: 'abortGenerate' })
    signal?.addEventListener('abort', onAbort, { once: true })
    this.inFlight++
    try {
      if (signal?.aborted) throw signal.reason // cancelled while the model was loading
      return await run()
    } finally {
      signal?.removeEventListener('abort', onAbort)
      this.inFlight--
      if (this.inFlight === 0) this.scheduleIdleUnload()
    }
  }

  /**
   * The one inference primitive every LLM feature is built on: hand it a
   * prompt (and optional JSON schema) and {@link withModel} takes care of the
   * model lifecycle. An abort rejects the returned promise.
   */
  async generate(prompt: string, schema?: object, signal?: AbortSignal): Promise<unknown> {
    return this.withModel(signal, () => this.send({ type: 'generate', prompt, schema }))
  }

  /**
   * One conversational turn: the caller supplies the full prior history (the
   * worker is stateless across turns) and receives the reply streamed through
   * `onPart` as full-part patches in {@link PART_FLUSH_MS} batches, then whole
   * in the result. Same lifecycle contract as {@link generate} — but an
   * aborted chat resolves with `interrupted: true` instead of rejecting.
   */
  async chat(
    history: ChatHistoryItem[],
    prompt: string,
    opts: {
      signal: AbortSignal
      /** narrows what the worker's query tool can see this turn */
      toolScope: ChatToolScope
      /** the scope's display currency; the worker stamps it into chart payloads */
      currency: string | null
      onPart: (index: number, part: StreamingChatPart) => void
    }
  ): Promise<ChatGenerationResult> {
    const { signal, toolScope, currency, onPart } = opts

    // register the handler before the command is posted so no early patch can
    // slip past. Each patch carries the full part, so coalescing is just
    // "latest per index"; flushing in index order preserves the transcript
    // order structurally, with no cross-kind flush rules.
    const id = this.nextId++
    const patches = new Map<number, StreamingChatPart>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      if (patches.size === 0) return
      const entries = [...patches.entries()].sort(([a], [b]) => a - b)
      patches.clear()
      for (const [index, part] of entries) onPart(index, part)
    }
    this.chatHandlers.set(id, (index, part) => {
      patches.set(index, part)
      flushTimer ??= setTimeout(flush, PART_FLUSH_MS)
    })

    try {
      const result = await this.withModel(signal, () =>
        this.sendWithId(id, { type: 'chat', history, prompt, toolScope, currency })
      )
      return result as ChatGenerationResult
    } finally {
      flush() // deliver any buffered tail before callers see the settled promise
      this.chatHandlers.delete(id)
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private scheduleIdleUnload(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.inFlight === 0 && this.getStatus().runtime === 'ready') void this.unload()
    }, IDLE_UNLOAD_MS)
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker

    const worker = utilityProcess.fork(workerEntry(), [], {
      serviceName: 'shmoney-llm',
      stdio: 'pipe',
      env: { ...process.env, LLM_MODELS_DIR: modelsDir(), SHMONEY_DB_PATH: dbPath }
    })
    worker.stdout?.on('data', (d) => log.debug('worker.stdout', { line: String(d).trimEnd() }))
    worker.stderr?.on('data', (d) => log.warn('worker.stderr', { line: String(d).trimEnd() }))
    worker.on('message', (msg: WorkerMessage) => this.handleWorkerMessage(msg))
    worker.on('exit', (code) => this.handleWorkerExit(code))

    this.worker = worker
    return worker
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    if ('event' in msg) {
      switch (msg.event) {
        case 'modelStage': {
          const status = this.getStatus()
          status.models[msg.modelId] = { stage: msg.stage, error: msg.error }
          this.pushStatus()
          break
        }
        case 'runtime': {
          const status = this.getStatus()
          status.runtime = msg.stage
          status.runtimeError = msg.error
          // the model left memory (idle unload, swap, delete, or load failure),
          // so nothing is loaded until the next request loads the selection
          if (msg.stage === 'unloaded') this.loadedModelId = null
          this.pushStatus()
          break
        }
        case 'downloadProgress':
          sendToRenderer(LLM_IPC.downloadProgress, msg.progress)
          break
        case 'chatPart':
          this.chatHandlers.get(msg.id)?.(msg.index, msg.part)
          break
      }
      return
    }
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    if (msg.ok) pending.resolve(msg.result)
    else pending.reject(new Error(msg.error))
  }

  private handleWorkerExit(code: number): void {
    for (const { reject } of this.pending.values()) {
      reject(new Error(`LLM worker exited unexpectedly (code ${code})`))
    }
    this.pending.clear()
    this.worker = null
    // the worker held the loaded model; it's gone with the process
    this.loadedModelId = null
    const status = this.getStatus()
    status.runtime = 'unloaded'
    status.runtimeError = code !== 0 ? `Worker exited unexpectedly (code ${code})` : null
    if (code !== 0) log.error('worker.exit', undefined, { code })
    this.pushStatus()
  }

  private send(command: DistributiveOmit<WorkerCommand, 'id'>): Promise<unknown> {
    return this.sendWithId(this.nextId++, command)
  }

  // split from send() so chat() can allocate its id up front and register a
  // chunk handler under it before the command reaches the worker
  private sendWithId(id: number, command: DistributiveOmit<WorkerCommand, 'id'>): Promise<unknown> {
    const worker = this.ensureWorker()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, ...command } as WorkerCommand)
    })
  }
}

export const llmManager = new LlmManager()
