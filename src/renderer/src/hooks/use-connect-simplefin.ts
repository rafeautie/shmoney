import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useNotify } from '@/lib/notify-store'
import { plural } from '@/lib/utils'

/** The SimpleFIN connect flow shared by the Settings card and the onboarding dialog:
 * exchange a setup token for a connection, kick off the first sync, and announce
 * what that sync touched. `syncConnection` is also the manual re-sync used on the
 * connected Settings card. Pass `onConnected` to react once the first sync lands. */
export function useConnectSimpleFin(options?: { onConnected?: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const notify = useNotify()

  const [setupToken, setSetupToken] = useState('')

  const syncConnection = useMutation({
    mutationFn: () => window.api.connection.sync(),
    // sync applies transfer detection and rules automatically; report what it
    // touched so those silent mutations stay visible and reviewable
    onSuccess: (result) => {
      if (result.detectedTransfers > 0) {
        notify(`Detected ${plural(result.detectedTransfers, 'transfer')}`, {
          description: 'Filed under the Transfers category; reports exclude them by default.',
          action: { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
        })
      }
      if (result.rulesApplied > 0) {
        notify(`Rules updated ${plural(result.rulesApplied, 'transaction')}`, {
          description: 'Applied automatically on sync.',
          action: { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
        })
      }
    },
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
