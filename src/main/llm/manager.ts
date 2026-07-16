import fs from 'node:fs'
import path from 'node:path'
import { app, utilityProcess, BrowserWindow, type UtilityProcess } from 'electron'
import type { ChatChunkKind } from '@shared/chat'
import { LLM_IPC, LLM_MODEL, type LlmDownloadProgress, type LlmStatus } from '@shared/llm'
import { createLogger } from '../logging'
import type {
  ChatGenerationResult,
  DistributiveOmit,
  WorkerCommand,
  WorkerMessage
} from './protocol'
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

// streamed chat tokens arrive faster than the UI needs paints; batch them so a
// 20-60 tok/s stream costs ~20 IPC messages a second instead of hundreds
const CHUNK_FLUSH_MS = 50

class LlmManager {
  private worker: UtilityProcess | null = null
  private status: LlmStatus | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  // chat streaming: chatChunk events route to their command's handler by id
  private chunkHandlers = new Map<number, (text: string, kind: ChatChunkKind) => void>()
  private inFlight = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  getStatus(): LlmStatus {
    if (!this.status) this.status = this.computeInitialStatus()
    return this.status
  }

  /** Size of the downloaded model file in bytes, or null if it isn't on disk. */
  getDiskSize(): number | null {
    try {
      return fs.statSync(path.join(modelsDir(), LLM_MODEL.fileName)).size
    } catch {
      return null
    }
  }

  private computeInitialStatus(): LlmStatus {
    const downloaded = fs.existsSync(path.join(modelsDir(), LLM_MODEL.fileName))
    return { stage: downloaded ? 'downloaded' : 'notDownloaded', error: null }
  }

  async download(): Promise<LlmStatus> {
    await this.send({ type: 'download' })
    return this.getStatus()
  }

  async cancelDownload(): Promise<void> {
    await this.send({ type: 'cancelDownload' })
  }

  private async load(): Promise<void> {
    await this.send({ type: 'load' })
  }

  private async unload(): Promise<void> {
    await this.send({ type: 'unload' })
  }

  /** Delete the downloaded model file, unloading it first if loaded. */
  async deleteModel(): Promise<LlmStatus> {
    this.clearIdleTimer()
    await this.send({ type: 'delete' })
    return this.getStatus()
  }

  /**
   * Model lifecycle shared by every inference request: load on first use,
   * relay `signal` as an abort command (an AbortSignal can't cross to the
   * worker), and count the request toward idle unload — once requests stop,
   * the model is unloaded after {@link IDLE_UNLOAD_MS} to give its RAM back.
   * Features never load or unload themselves.
   */
  private async withModel<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    this.clearIdleTimer()
    const status = this.getStatus()
    if (status.stage === 'downloaded') {
      await this.load()
    } else if (status.stage !== 'ready') {
      throw new Error(`Model is not ready (${status.stage})`)
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
   * `onChunk` in {@link CHUNK_FLUSH_MS} batches, then whole in the result.
   * Same lifecycle contract as {@link generate} — but an aborted chat
   * resolves with `interrupted: true` instead of rejecting.
   */
  async chat(
    history: ChatHistoryItem[],
    prompt: string,
    opts: { signal?: AbortSignal; onChunk?: (text: string, kind: ChatChunkKind) => void } = {}
  ): Promise<ChatGenerationResult> {
    const { signal, onChunk } = opts

    // register the chunk handler before the command is posted so no early
    // token can slip past; buffer and flush on a timer to keep IPC cheap.
    // A batch holds one kind of text: a kind change (thought → answer)
    // flushes what's buffered so ordering survives the batching.
    const id = this.nextId++
    let buffer = ''
    let bufferKind: ChatChunkKind = 'text'
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      if (!buffer || !onChunk) return
      const text = buffer
      buffer = ''
      onChunk(text, bufferKind)
    }
    this.chunkHandlers.set(id, (text, kind) => {
      if (kind !== bufferKind) {
        flush()
        bufferKind = kind
      }
      buffer += text
      flushTimer ??= setTimeout(flush, CHUNK_FLUSH_MS)
    })

    try {
      const result = await this.withModel(signal, () =>
        this.sendWithId(id, { type: 'chat', history, prompt })
      )
      return result as ChatGenerationResult
    } finally {
      if (flushTimer) clearTimeout(flushTimer)
      flush() // deliver any buffered tail before callers see the settled promise
      this.chunkHandlers.delete(id)
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
      if (this.inFlight === 0 && this.getStatus().stage === 'ready') void this.unload()
    }, IDLE_UNLOAD_MS)
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker

    const worker = utilityProcess.fork(workerEntry(), [], {
      serviceName: 'shmoney-llm',
      stdio: 'pipe',
      env: { ...process.env, LLM_MODELS_DIR: modelsDir() }
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
      if (msg.event === 'status') {
        this.status = msg.status
        sendToRenderer(LLM_IPC.statusChanged, msg.status)
      } else if (msg.event === 'chatChunk') {
        this.chunkHandlers.get(msg.id)?.(msg.text, msg.kind)
      } else {
        sendToRenderer(LLM_IPC.downloadProgress, msg.progress satisfies LlmDownloadProgress)
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
    if (code !== 0) {
      log.error('worker.exit', undefined, { code })
      this.status = { stage: 'error', error: `Worker exited unexpectedly (code ${code})` }
      sendToRenderer(LLM_IPC.statusChanged, this.status)
    }
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
