import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { notify, notifyOs } from '@/lib/notify'
import { ipcErrorMessage } from '@/lib/utils'
import { actionNeededErrors } from '@shared/ipc'

/** Shared by every sync trigger so `useIsMutating` sees any of them in flight. */
export const SYNC_MUTATION_KEY = ['connection', 'sync']

/** The SimpleFIN connect flow shared by the Settings card and the onboarding dialog:
 * exchange a setup token for a connection, kick off the first sync, and announce
 * when it lands. `syncConnection` is also the manual re-sync used on the
 * connected Settings card. Pass `onConnected` to react once the first sync lands. */
export function useConnectSimpleFin(options?: { onConnected?: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [setupToken, setSetupToken] = useState('')

  const syncConnection = useMutation({
    mutationKey: SYNC_MUTATION_KEY,
    mutationFn: () => window.api.connection.sync(),
    // what sync changed (transfers, rules) lands on the Activity dot, and
    // problems on the Settings dot and Accounts alerts; only the OS hears of them
    onSuccess: (result) => {
      const actionNeeded = actionNeededErrors(result.lastSyncErrors)
      if (actionNeeded.length > 0) {
        notifyOs('SimpleFIN needs your attention', actionNeeded.map((e) => e.msg).join(' '))
      }
    },
    // covers auto-sync too, which otherwise fails with nothing on screen
    onError: (error) => notify.error('Sync failed', { description: ipcErrorMessage(error) }),
    onSettled: () => queryClient.invalidateQueries()
  })

  const connect = useMutation({
    mutationFn: () => window.api.connection.connect({ setupToken }),
    onSuccess: () => {
      setSetupToken('')
      queryClient.invalidateQueries()
      // kick off the first sync and announce setup completion when it lands; the
      // per-call callback fires only for this initial run, not manual re-syncs
      syncConnection.mutate(undefined, {
        onSuccess: () => {
          notify('SimpleFIN connected', {
            description: 'Your accounts and transactions are ready.',
            action: { label: 'View accounts', onClick: () => navigate({ to: '/accounts' }) }
          })
          options?.onConnected?.()
        }
      })
    }
  })

  return { setupToken, setSetupToken, connect, syncConnection }
}
