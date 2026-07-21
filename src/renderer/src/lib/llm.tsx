import { useEffect, useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  DEFAULT_MODEL_ID,
  MODEL_IDS,
  llmSupported,
  recommendedModelId,
  type LlmDownloadProgress,
  type LlmStatus,
  type ModelId,
  type ModelState
} from '@shared/llm'
import type { CategorizeScopeInput } from '@shared/ipc'
import { ipcErrorMessage, plural } from '@/lib/utils'
import { useNotify } from '@/lib/notify-store'

export const LLM_STATUS_QUERY_KEY = ['llm', 'status'] as const
export const LLM_HARDWARE_QUERY_KEY = ['llm', 'hardware'] as const

export function useLlmStatus() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: LLM_STATUS_QUERY_KEY,
    queryFn: () => window.api.llm.getStatus()
  })

  useEffect(() => {
    return window.api.llm.onStatusChanged((status) => {
      queryClient.setQueryData<LlmStatus>(LLM_STATUS_QUERY_KEY, status)
    })
  }, [queryClient])

  return query
}

/** Total system RAM, cached for the session (hardware doesn't change). Drives
 * which models are offered and which one is recommended. */
export function useHardware() {
  return useQuery({
    queryKey: LLM_HARDWARE_QUERY_KEY,
    queryFn: () => window.api.llm.getHardware(),
    staleTime: Infinity
  })
}

/** False only once we know the machine can't run even the smallest model —
 * optimistic while hardware is loading so the UI doesn't flash "unsupported". */
export function useLlmSupported(): boolean {
  const hw = useHardware().data
  return hw ? llmSupported(hw) : true
}

/** The model recommended for this hardware (largest one it can run), or null
 * when nothing runs / hardware isn't known yet. */
export function useRecommendedModel(): ModelId | null {
  const hw = useHardware().data
  return hw ? recommendedModelId(hw) : null
}

/** The model inference currently uses. */
export function useSelectedModel(): ModelId {
  return useLlmStatus().data?.selected ?? DEFAULT_MODEL_ID
}

/** One model's download/file state. */
export function useModelState(modelId: ModelId): ModelState {
  return useLlmStatus().data?.models[modelId] ?? { stage: 'notDownloaded', error: null }
}

/**
 * Gate for any LLM-powered feature: the machine must support a model and the
 * selected one must be on disk (it loads into memory automatically on first
 * request, so "loaded" isn't a precondition the UI drives separately).
 */
export function useLlmReady(): boolean {
  const status = useLlmStatus().data
  const supported = useLlmSupported()
  if (!status || !supported) return false
  return status.models[status.selected].stage === 'downloaded'
}

/**
 * Live download progress per model while it downloads; a model that isn't
 * actively downloading reads null, so a finished run's final numbers never
 * linger. One subscription feeds both models — read `progress[id]` per row.
 */
export function useLlmDownloadProgress(): Record<ModelId, LlmDownloadProgress | null> {
  const models = useLlmStatus().data?.models
  const [progress, setProgress] = useState<Record<ModelId, LlmDownloadProgress | null>>({
    e2b: null,
    e4b: null
  })

  useEffect(
    () =>
      window.api.llm.onDownloadProgress((p) =>
        setProgress((prev) => ({ ...prev, [p.modelId]: p }))
      ),
    []
  )

  const result: Record<ModelId, LlmDownloadProgress | null> = { e2b: null, e4b: null }
  for (const id of MODEL_IDS) {
    if (models?.[id].stage === 'downloading') result[id] = progress[id]
  }
  return result
}

/**
 * The download/delete/select actions the model picker drives. Each invalidates
 * the `llm` query family so on-disk sizes and status refetch after the action;
 * live status also arrives on its own via onStatusChanged.
 */
export function useModelActions() {
  const queryClient = useQueryClient()
  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['llm'] })
  return {
    download: useMutation({
      mutationFn: (modelId: ModelId) => window.api.llm.download(modelId),
      onSettled: invalidate
    }),
    cancelDownload: useMutation({
      mutationFn: (modelId: ModelId) => window.api.llm.cancelDownload(modelId),
      onSettled: invalidate
    }),
    deleteModel: useMutation({
      mutationFn: (modelId: ModelId) => window.api.llm.deleteModel(modelId),
      onSettled: invalidate
    }),
    select: useMutation({
      mutationFn: (modelId: ModelId) => window.api.llm.selectModel(modelId),
      onSettled: invalidate
    })
  }
}

export interface AutoCategorize {
  /** true while this trigger's own run is in flight */
  isRunning: boolean
  /** true while any categorize run is active anywhere — blocks starting a second */
  anyRunning: boolean
  start: () => void
}

// shared key so every trigger's run is the same mutation to `useIsMutating`,
// which is how they see (and block on) a run started by another trigger — and how
// the notification center observes a run without owning it
export const CATEGORIZE_MUTATION_KEY = ['llm', 'categorize'] as const

/**
 * Owns a whole auto-categorize run for a scope — a selection, one account, or
 * (empty scope) every transaction: starts it and reports the result. Applies
 * immediately as one undoable action-log entry — the notification's Review action
 * links to the Activity page, the undo surface. Only one run happens at a time app-wide
 * (see `anyRunning`), since the worker shares a single chat session. Live progress
 * and cancel are surfaced by the navbar notification center, not here.
 */
export function useAutoCategorize(scope: CategorizeScopeInput): AutoCategorize {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const notify = useNotify()
  const anyRunning = useIsMutating({ mutationKey: CATEGORIZE_MUTATION_KEY }) > 0

  const run = useMutation({
    mutationKey: CATEGORIZE_MUTATION_KEY,
    mutationFn: () => window.api.llm.categorize(scope),
    onSuccess: (result) => {
      if (result.categorized > 0) {
        notify(`Categorized ${plural(result.categorized, 'transaction')}`, {
          description: 'Applied Auto suggestions.',
          action: { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
        })
      } else if (!result.cancelled) {
        // a cancel before anything was applied is a deliberate stop, not a
        // "nothing matched" result, so it stays silent
        notify('Nothing to categorize', {
          description: 'Those transactions are already categorized, transfers, or pending.'
        })
      }
    },
    onError: (error) => notify.error(ipcErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries()
  })

  return {
    isRunning: run.isPending,
    anyRunning,
    start: () => run.mutate()
  }
}
