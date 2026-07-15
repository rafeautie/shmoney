import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateState } from '@shared/updates'

export const UPDATE_STATE_QUERY_KEY = ['updates', 'state'] as const

/** App-update state, seeded by an invoke and kept live by main-process pushes. */
export function useUpdateState() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: UPDATE_STATE_QUERY_KEY,
    queryFn: () => window.api.updates.getState()
  })

  useEffect(() => {
    return window.api.updates.onStateChanged((state) => {
      queryClient.setQueryData<UpdateState>(UPDATE_STATE_QUERY_KEY, state)
    })
  }, [queryClient])

  return query
}
