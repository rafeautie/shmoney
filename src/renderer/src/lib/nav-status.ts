import { useIsMutating, useQuery } from '@tanstack/react-query'
import { LLM_MODELS, MODEL_IDS } from '@shared/llm'
import { connectionNeedsAttention } from '@shared/ipc'
import { SYNC_MUTATION_KEY } from '@/hooks/use-connect-simplefin'
import { useUnseenActivity } from '@/lib/activity-seen'
import { useCategorizeRun, useLlmDownloadProgress, useLlmStatus } from '@/lib/llm'
import { connectionOptions } from '@/lib/queries'
import { useUpdateState } from '@/lib/updates'
import type { SettingsSection } from '@/lib/settings-dialog'

// attention: the user needs to act; busy: work in progress; info: something new
export type DotTone = 'attention' | 'busy' | 'info'

export interface DotStatus {
  tone: DotTone
  tooltip: string
}

// Each sidebar item's dot. Where several apply, the first listed wins: things
// the user must fix, then running work, then news.

const TONE_RANK: Record<DotTone, number> = { attention: 0, busy: 1, info: 2 }

/** The settings dialog's per-section dots; the sidebar's Settings item shows the most urgent. */
export function useSettingsSectionStatuses(): Partial<Record<SettingsSection, DotStatus | null>> {
  return {
    connection: useConnectionStatus(),
    ai: useModelStatus(),
    about: useUpdateStatus()
  }
}

export function useSettingsStatus(): DotStatus | null {
  const statuses = Object.values(useSettingsSectionStatuses()).filter((s) => s != null)
  // stable sort keeps section order among equal tones
  return statuses.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])[0] ?? null
}

function useConnectionStatus(): DotStatus | null {
  const { data: connection } = useQuery(connectionOptions)
  return connection && connectionNeedsAttention(connection)
    ? { tone: 'attention', tooltip: 'SimpleFIN needs your attention' }
    : null
}

function useModelStatus(): DotStatus | null {
  const models = useLlmStatus().data?.models
  const progress = useLlmDownloadProgress()

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
  return null
}

function useUpdateStatus(): DotStatus | null {
  const update = useUpdateState().data
  if (update?.status === 'downloaded') {
    return { tone: 'info', tooltip: 'Update ready, restart to install' }
  }
  if (update?.status === 'available') {
    return { tone: 'info', tooltip: `Update available: v${update.version}` }
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
