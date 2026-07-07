import { useEffect, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { LLM_MODEL, type CategorizeProgress } from '@shared/llm'
import { CATEGORIZE_MUTATION_KEY, useLlmDownloadProgress, useLlmStatus } from '@/lib/llm'

export interface Notification {
  id: string
  title: string
  /** progress-bar fill 0–100, or null while the job is running but not yet measurable */
  percent: number | null
  /** status line shown under the bar */
  detail: string
  /** true from the cancel click until the job finishes */
  canceling: boolean
  cancel: () => void
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** A cancel request that reads as "Cancelling…" until `active` drops to false. */
function useCancelable(
  active: boolean,
  cancelFn: () => void
): { canceling: boolean; cancel: () => void } {
  const [canceling, setCanceling] = useState(false)
  useEffect(() => {
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
  const downloading = useLlmStatus().data?.stage === 'downloading'
  const progress = useLlmDownloadProgress()
  const { canceling, cancel } = useCancelable(
    downloading,
    () => void window.api.llm.cancelDownload()
  )

  if (!downloading) return null
  return {
    id: 'llm-download',
    title: `Downloading ${LLM_MODEL.label}`,
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

/**
 * The in-flight background jobs the navbar notification center shows — currently
 * the model download and an auto-categorize run. Each is a global singleton, so
 * this observes their existing status/mutation signals rather than owning them.
 */
export function useNotifications(): Notification[] {
  const download = useDownloadNotification()
  const categorize = useCategorizeNotification()
  return [download, categorize].filter((n): n is Notification => n !== null)
}
