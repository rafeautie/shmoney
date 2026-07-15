import { useEffect, useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { LlmDownloadProgress, LlmStatus } from '@shared/llm'
import type { CategorizeScopeInput } from '@shared/ipc'
import { ipcErrorMessage, plural } from '@/lib/utils'
import { useNotify } from '@/lib/notify-store'

export const LLM_STATUS_QUERY_KEY = ['llm', 'status'] as const

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

/**
 * Gate for any LLM-powered feature: usable once a model is downloaded (it
 * loads into memory automatically on first request, so "loaded" isn't a
 * precondition the UI needs to drive separately).
 */
export function useLlmReady(): boolean {
  const { data } = useLlmStatus()
  return data?.stage === 'downloaded' || data?.stage === 'ready'
}

/** Live download progress while the model is downloading, else null. */
export function useLlmDownloadProgress(): LlmDownloadProgress | null {
  const downloading = useLlmStatus().data?.stage === 'downloading'
  const [progress, setProgress] = useState<LlmDownloadProgress | null>(null)

  useEffect(() => window.api.llm.onDownloadProgress(setProgress), [])
  // clear between downloads so a later one doesn't flash the previous final value
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets push-fed state when the run ends; there is no render-derivable source for it
    if (!downloading) setProgress(null)
  }, [downloading])

  return downloading ? progress : null
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
