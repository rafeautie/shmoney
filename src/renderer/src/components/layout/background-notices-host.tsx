import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Conversation } from '@shared/chat'
import { LLM_MODELS, MODEL_IDS, type ModelId, type ModelStage } from '@shared/llm'
import { CHAT_CONVERSATIONS_KEY } from '@/lib/chat'
import { useLlmStatus } from '@/lib/llm'
import { notify, notifyOs } from '@/lib/notify'
import { useUpdateState } from '@/lib/updates'

/** A model download the user started finished: worth a toast wherever they are now. */
function useDownloadCompleteNotice() {
  const models = useLlmStatus().data?.models
  const prev = useRef<Partial<Record<ModelId, ModelStage>>>({})
  useEffect(() => {
    for (const id of MODEL_IDS) {
      const wasInProgress = prev.current[id] === 'downloading' || prev.current[id] === 'verifying'
      if (wasInProgress && models?.[id].stage === 'downloaded') {
        notify(`${LLM_MODELS[id].label} ready`, { description: 'Download complete.' })
      }
    }
    prev.current = models
      ? Object.fromEntries(MODEL_IDS.map((id) => [id, models[id].stage]))
      : prev.current
  }, [models])
}

/** In-app, the Settings dot carries a ready update; this only reaches the OS. */
function useUpdateReadyNotice() {
  const state = useUpdateState().data
  const prev = useRef(state?.status)
  useEffect(() => {
    if (state?.status === 'downloaded' && prev.current !== 'downloaded') {
      notifyOs(
        state.version ? `Update ready: v${state.version}` : 'Update ready',
        'Restart shmoney to finish installing.'
      )
    }
    prev.current = state?.status
  }, [state])
}

/**
 * Pushes that must land wherever the user is: a reply finishing refreshes the
 * thread list (its sidebar dot) even off the chat page, and new rule
 * suggestions refresh the list behind the Activity dot.
 */
function usePushRefreshes() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const offDone = window.api.chat.onMessageDone(({ conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
      const title = queryClient
        .getQueryData<Conversation[]>(CHAT_CONVERSATIONS_KEY)
        ?.find((c) => c.id === conversationId)?.title
      notifyOs(title ?? 'Chat', 'Reply ready.')
    })
    const offSuggestions = window.api.ruleSuggestions.onCreated(() => {
      void queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
    })
    return () => {
      offDone()
      offSuggestions()
    }
  }, [queryClient])
}

/** Mounted once at the root: background completions that have no page of their own to report on. */
export function BackgroundNoticesHost(): null {
  useDownloadCompleteNotice()
  useUpdateReadyNotice()
  usePushRefreshes()
  return null
}
