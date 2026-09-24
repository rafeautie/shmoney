import { useIsMutating, useQuery } from '@tanstack/react-query'
import { LLM_MODELS, MODEL_IDS } from '@shared/llm'
import { connectionNeedsAttention } from '@shared/ipc'
import { SYNC_MUTATION_KEY } from '@/hooks/use-connect-simplefin'
import { useUnseenActivity } from '@/lib/activity-seen'
import { useCategorizeRun, useLlmDownloadProgress, useLlmStatus } from '@/lib/llm'
import { connectionOptions } from '@/lib/queries'
import { useUpdateState } from '@/lib/updates'

// attention: the user needs to act; busy: work in progress; info: something new
export type DotTone = 'attention' | 'busy' | 'info'

export interface DotStatus {
  tone: DotTone
  tooltip: string
}

// Each sidebar item's dot. Where several apply, the first listed wins: things
// the user must fix, then running work, then news.

export function useSettingsStatus(): DotStatus | null {
  const { data: connection } = useQuery(connectionOptions)
  const models = useLlmStatus().data?.models
  const progress = useLlmDownloadProgress()
  const update = useUpdateState().data

  if (connection && connectionNeedsAttention(connection)) {
    return { tone: 'attention', tooltip: 'SimpleFIN needs your attention' }
  }
  if (models && MODEL_IDS.some((id) => models[id].stage === 'error')) {
    return { tone: 'attention', tooltip: 'Model download failed' }
  }
  const downloading = MODEL_IDS.find(
    (id) => models?.[id].stage === 'downloading' || models?.[id].stage === 'verifying'
  )
  if (downloading) {
    const p = progress[downloading]
    const percent =
      p && p.totalBytes > 0 ? ` ${Math.round((p.downloadedBytes / p.totalBytes) * 100)}%` : ''
    return {
      tone: 'busy',
      tooltip:
        models?.[downloading].stage === 'verifying'
          ? `Verifying ${LLM_MODELS[downloading].label}`
          : `Downloading ${LLM_MODELS[downloading].label}${percent}`
    }
  }
  if (update?.status === 'downloaded') {
    return { tone: 'info', tooltip: 'Update ready, restart to install' }
  }
  return null
}

export function useAccountsStatus(): DotStatus | null {
  const syncing = useIsMutating({ mutationKey: SYNC_MUTATION_KEY }) > 0
  const categorize = useCategorizeRun()

  if (categorize.running) {
    const p = categorize.progress
    return {
      tone: 'busy',
      tooltip:
        p && p.total > 0 ? `Auto-categorizing ${p.processed} of ${p.total}` : 'Auto-categorizing'
    }
  }
  if (syncing) return { tone: 'busy', tooltip: 'Syncing accounts' }
  return null
}

export function useActivityStatus(): DotStatus | null {
  return useUnseenActivity() ? { tone: 'info', tooltip: 'New automatic changes' } : null
}
