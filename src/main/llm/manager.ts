import fs from 'node:fs'
import path from 'node:path'
import { app, utilityProcess, BrowserWindow, type UtilityProcess } from 'electron'
import type { StreamingChatPart } from '@shared/chat'
import { LLM_IPC, LLM_MODEL, type LlmDownloadProgress, type LlmStatus } from '@shared/llm'
import { dbPath } from '../db'
import { createLogger } from '../logging'
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

class LlmManager {
  private worker: UtilityProcess | null = null
  private status: LlmStatus | null = null
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
      if (this.inFlight === 0 && this.getStatus().stage === 'ready') void this.unload()
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
        case 'status':
          this.status = msg.status
          sendToRenderer(LLM_IPC.statusChanged, msg.status)
          break
        case 'downloadProgress':
          sendToRenderer(LLM_IPC.downloadProgress, msg.progress satisfies LlmDownloadProgress)
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
