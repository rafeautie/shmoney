import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useNotify } from '@/lib/notify-store'
import { ipcErrorMessage, plural } from '@/lib/utils'
import { actionNeededErrors } from '@shared/ipc'

/** Shared by every sync trigger so `useIsMutating` sees any of them in flight. */
export const SYNC_MUTATION_KEY = ['connection', 'sync']

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
    mutationKey: SYNC_MUTATION_KEY,
    mutationFn: () => window.api.connection.sync(),
    // sync applies transfer detection and rules automatically; report what it
    // touched so those silent mutations stay visible and reviewable
    onSuccess: (result) => {
      // transient errlist entries stay on the Accounts banner; only ones the
      // user must fix earn a notification (and the red ring)
      const actionNeeded = actionNeededErrors(result.lastSyncErrors)
      if (actionNeeded.length > 0) {
        notify.error('SimpleFIN needs your attention', {
          description: actionNeeded.map((e) => e.msg).join(' '),
          action: { label: 'View', onClick: () => navigate({ to: '/accounts' }) }
        })
      }
      if (result.matchedImports > 0) {
        notify(`Matched ${plural(result.matchedImports, 'imported transaction')}`, {
          description:
            'Your bank now reports these, so sync updated your transactions instead of adding copies.'
        })
      }
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
