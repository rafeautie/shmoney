// Model files on disk: download, verify, cancel, delete.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createModelDownloader } from 'node-llama-cpp'
import { LLM_MODELS, type ModelId } from '@shared/llm'
import { post, postModelStage } from './port'

const modelsDir: string = (() => {
  const dir = process.env.LLM_MODELS_DIR
  if (!dir) throw new Error('LLM_MODELS_DIR is not set')
  return dir
})()
fs.mkdirSync(modelsDir, { recursive: true })

// in-flight downloads, keyed by model so models can download independently
// and a cancel targets one. `canceled` lets us tell a user cancel apart from a
// real failure: aborting can make download() either resolve or reject, so the
// outcome is decided by this flag, not by whether the promise threw.
const activeDownloads = new Map<ModelId, { abortController: AbortController; canceled: boolean }>()

const PROGRESS_INTERVAL_MS = 250

export function modelFilePath(modelId: ModelId): string {
  return path.join(modelsDir, LLM_MODELS[modelId].fileName)
}

export async function downloadModel(modelId: ModelId): Promise<null> {
  const model = LLM_MODELS[modelId]
  const record = { abortController: new AbortController(), canceled: false }
  activeDownloads.set(modelId, record)
  postModelStage(modelId, 'downloading')

  // every chunk reports progress; the renderer redraws per push, so ~4 Hz
  // (plus the final 100%) is all that's forwarded
  let lastProgressAt = 0
  try {
    const downloader = await createModelDownloader({
      modelUri: model.hfUri,
      dirPath: modelsDir,
      fileName: model.fileName,
      skipExisting: true,
      onProgress: ({ totalSize, downloadedSize }) => {
        const now = Date.now()
        if (now - lastProgressAt < PROGRESS_INTERVAL_MS && downloadedSize < totalSize) return
        lastProgressAt = now
        post({
          event: 'downloadProgress',
          progress: { modelId, downloadedBytes: downloadedSize, totalBytes: totalSize }
        })
      }
    })
    await downloader.download({ signal: record.abortController.signal })
  } catch (err) {
    // a canceled download can reject; that's not a failure, so fall through to
    // the flag below. Only a genuine error surfaces as an error status.
    if (!record.canceled) {
      postModelStage(modelId, 'error', String(err))
      throw err
    }
  } finally {
    activeDownloads.delete(modelId)
  }

  // Verify the finished file against the pinned hash before ever reporting it
  // as downloaded; a mismatched file (corrupted or tampered upstream) is
  // deleted on the spot so it can never be loaded.
  if (!record.canceled) {
    const filePath = modelFilePath(modelId)
    postModelStage(modelId, 'verifying')
    const hash = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(filePath), hash)
    const actual = hash.digest('hex')
    if (actual !== model.sha256) {
      await fs.promises.rm(filePath, { force: true })
      const error = 'Downloaded model failed checksum verification and was deleted'
      postModelStage(modelId, 'error', error)
      throw new Error(`${error} (expected ${model.sha256}, got ${actual})`)
    }
  }

  // A cancel removes the partial file, so the model is back to notDownloaded; a
  // real completion is downloaded. Decided by the flag, not the promise outcome.
  postModelStage(modelId, record.canceled ? 'notDownloaded' : 'downloaded')
  return null
}

export function cancelDownload(modelId: ModelId): null {
  const record = activeDownloads.get(modelId)
  if (!record) return null
  record.canceled = true
  record.abortController.abort()
  return null
}

/** remove the file; the caller unloads it first, since Windows locks a mapped file */
export async function deleteModelFile(modelId: ModelId): Promise<null> {
  await fs.promises.rm(modelFilePath(modelId), { force: true })
  postModelStage(modelId, 'notDownloaded')
  return null
}
