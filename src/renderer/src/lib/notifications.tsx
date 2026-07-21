import { useEffect, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { LLM_MODELS, MODEL_IDS, type CategorizeProgress } from '@shared/llm'
import { CATEGORIZE_MUTATION_KEY, useLlmDownloadProgress, useLlmStatus } from '@/lib/llm'
import { useUpdateState } from '@/lib/updates'

export interface Notification {
  id: string
  title: string
  /** progress-bar fill 0–100, or null while the job is running but not yet measurable */
  percent: number | null
  /** status line shown under the bar */
  detail: string
  /** true from the cancel click until the job finishes */
  canceling: boolean
  /** absent when the job has passed the point where cancelling is possible */
  cancel?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** A cancel request that reads as "Cancelling…" until `active` drops to false. */
function useCancelable(
  active: boolean,
  cancelFn: () => void
): { canceling: boolean; cancel: () => void } {
  const [canceling, setCanceling] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the transient "Cancelling…" flag when the run actually ends
    if (!active) setCanceling(false)
  }, [active])
  return {
    canceling,
    cancel: () => {
      setCanceling(true)
      cancelFn()
    }
  }
}

function useDownloadNotification(): Notification | null {
  const models = useLlmStatus().data?.models
  const progressByModel = useLlmDownloadProgress()
  // at most one model downloads at a time, so the first match is the active one
  const activeId =
    MODEL_IDS.find(
      (id) => models?.[id].stage === 'downloading' || models?.[id].stage === 'verifying'
    ) ?? null
  const stage = activeId ? models?.[activeId].stage : undefined
  const downloading = stage === 'downloading'
  const progress = activeId ? progressByModel[activeId] : null
  const { canceling, cancel } = useCancelable(downloading, () => {
    if (activeId) void window.api.llm.cancelDownload(activeId)
  })

  // the post-download hash check: still the same job, but past cancelling
  if (stage === 'verifying' && activeId) {
    return {
      id: 'llm-download',
      title: `Verifying ${LLM_MODELS[activeId].label}`,
      percent: 100,
      detail: 'Checking file integrity…',
      canceling: false
    }
  }

  if (!downloading || !activeId) return null
  return {
    id: 'llm-download',
    title: `Downloading ${LLM_MODELS[activeId].label}`,
    percent:
      progress && progress.totalBytes > 0
        ? (progress.downloadedBytes / progress.totalBytes) * 100
        : null,
    detail: progress
      ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
      : 'Starting download…',
    canceling,
    cancel
  }
}

function useCategorizeNotification(): Notification | null {
  const running = useIsMutating({ mutationKey: CATEGORIZE_MUTATION_KEY }) > 0
  const [progress, setProgress] = useState<CategorizeProgress | null>(null)
  const { canceling, cancel } = useCancelable(running, () => void window.api.llm.cancelCategorize())

  useEffect(() => window.api.llm.onCategorizeProgress(setProgress), [])
  // drop a finished run's final numbers so the next run opens on "Loading model…"
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets push-fed state when the run ends; there is no render-derivable source for it
    if (!running) setProgress(null)
  }, [running])

  if (!running) return null
  return {
    id: 'llm-categorize',
    title: 'Auto-categorizing',
    percent: progress && progress.total > 0 ? (progress.processed / progress.total) * 100 : null,
    detail: progress ? `${progress.processed} / ${progress.total} transactions` : 'Loading model…',
    canceling,
    cancel
  }
}

function useUpdateDownloadNotification(): Notification | null {
  const state = useUpdateState().data
  if (state?.status !== 'downloading') return null
  return {
    id: 'app-update',
    title: state.version ? `Downloading update v${state.version}` : 'Downloading update',
    percent: state.progress?.percent ?? null,
    detail: state.progress
      ? `${formatBytes(state.progress.transferred)} / ${formatBytes(state.progress.total)}`
      : 'Starting download…',
    // no cancel: electron-updater has no clean cancel, and the download is silent anyway
    canceling: false
  }
}

/**
 * The in-flight background jobs the navbar notification center shows — currently
 * the model download, an auto-categorize run, and an app-update download. Each is
 * a global singleton, so this observes their existing status/mutation signals
 * rather than owning them.
 */
export function useNotifications(): Notification[] {
  const download = useDownloadNotification()
  const categorize = useCategorizeNotification()
  const update = useUpdateDownloadNotification()
  return [download, categorize, update].filter((n): n is Notification => n !== null)
}
