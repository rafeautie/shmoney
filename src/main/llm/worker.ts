// Runs as a dedicated Electron utilityProcess. This file and ./worker/ are the
// only code that imports node-llama-cpp: the main process and renderer never
// touch it directly, so a crash or heavy generation here can't take down the UI.
import { DisposedError } from 'node-llama-cpp'
import type { WorkerCommand } from './protocol'
import { runChatTurn } from './worker/chat-turn'
import { runGenerate } from './worker/generate'
import { cancelDownload, deleteModelFile, downloadModel } from './worker/models'
import { post } from './worker/port'
import { ensureLoaded, isLoaded, requestRecycle, unload } from './worker/runtime'

// after the queue drains, keep the model in memory this long in case another
// request follows, then unload it to give its RAM back
const IDLE_UNLOAD_MS = 60_000

// Everything that touches the model in memory runs through this chain, one job
// at a time: loads, swaps, unloads, deletes and generations can never
// interleave, and generate and chat can share one context sequence.
let chain: Promise<unknown> = Promise.resolve()
let queued = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  queued++
  const result = chain.then(job)
  chain = result
    .catch(() => undefined)
    .then(() => {
      queued--
      if (queued === 0 && isLoaded()) {
        idleTimer = setTimeout(() => void enqueue(() => unload()), IDLE_UNLOAD_MS)
      }
    })
  return result
}

// a controller per generate/chat from the moment it arrives, so an abort lands
// whether the request is running or still queued
const aborts = new Map<number, AbortController>()

function inference<T>(id: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  aborts.set(id, controller)
  return enqueue(() => run(controller.signal)).finally(() => aborts.delete(id))
}

async function dispatch(command: WorkerCommand): Promise<unknown> {
  switch (command.type) {
    case 'download':
      return downloadModel(command.modelId)
    case 'cancelDownload':
      return cancelDownload(command.modelId)
    case 'delete':
      return enqueue(async () => {
        // Windows keeps a memory-mapped file locked
        await unload(command.modelId)
        return deleteModelFile(command.modelId)
      })
    case 'unload':
      return enqueue(async () => {
        await unload()
        return null
      })
    case 'abort':
      aborts.get(command.targetId)?.abort(new Error('Generation cancelled'))
      return null
    case 'generate':
      return inference(command.id, async (signal) => {
        signal.throwIfAborted()
        const { generateSession } = await ensureLoaded(command.modelId)
        signal.throwIfAborted()
        return runGenerate(
          command.id,
          generateSession,
          command.modelId,
          command.prompt,
          command.schema,
          signal
        )
      })
    case 'chat':
      return inference(command.id, async (signal) => {
        if (signal.aborted) return { parts: [], interrupted: true }
        const { chatSession } = await ensureLoaded(command.modelId)
        if (signal.aborted) return { parts: [], interrupted: true }
        return runChatTurn(command, chatSession, command.modelId, signal)
      })
  }
}

process.parentPort.on('message', (e) => {
  const command = e.data as WorkerCommand
  dispatch(command)
    .then((result) => post({ id: command.id, ok: true, result }))
    .catch((err) => {
      // the load path should make this unreachable; if a disposed object still
      // surfaces, this process's runtime can't be trusted any more
      if (err instanceof DisposedError) {
        requestRecycle(`disposed object used by ${command.type}`)
        err = new Error('The model stopped unexpectedly. Try again.')
      }
      post({ id: command.id, ok: false, error: String((err as Error)?.message ?? err) })
    })
})
