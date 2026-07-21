import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useNotify } from '@/lib/notify-store'
import { useConnectSimpleFin } from '@/hooks/use-connect-simplefin'

const DAY_MS = 24 * 60 * 60 * 1000

// how often, while the app is open, we re-check whether a day has elapsed. A
// plain timestamp comparison, so this is cheap; a coarse interval is enough to
// catch the 24h mark being crossed mid-session, and it survives sleep/wake
// because the check reads the wall clock rather than counting ticks.
const CHECK_INTERVAL_MS = 30 * 60 * 1000

/**
 * Mounted once at the root: keeps the connection synced roughly daily. It fires
 * a background sync when more than 24h have passed since the last successful one
 * (connection.lastSyncedAt) — immediately on launch if the app was closed across
 * that mark, and on a coarse interval so an app left open still syncs when the
 * mark is crossed. Reuses the same sync path as the manual button, so transfer
 * detection, rules, and query invalidation all run; a completion message lands
 * in the notification center on top of whatever that sync touched.
 */
export function AutoSyncHost(): null {
  const notify = useNotify()
  const navigate = useNavigate()
  const { syncConnection } = useConnectSimpleFin()
  const { mutate } = syncConnection

  const { data: connection } = useQuery({
    queryKey: ['connection'],
    queryFn: () => window.api.connection.get()
  })
  const lastSyncedAt = connection?.lastSyncedAt ?? null

  // the lastSyncedAt we last kicked a sync off for. After mutate() fires, the
  // connection query refetches and isPending flips before lastSyncedAt lands, so
  // guard on the timestamp itself to avoid re-firing for the same stale value.
  // A failed auto-sync leaves lastSyncedAt untouched, so it won't retry in a
  // loop; the next launch (fresh mount) gives it one more try.
  const triggeredFor = useRef<number | null>(null)

  useEffect(() => {
    // never synced (or no connection): the connect flow owns the first sync
    if (lastSyncedAt === null) return

    const check = (): void => {
      if (Date.now() - lastSyncedAt * 1000 < DAY_MS) return
      if (triggeredFor.current === lastSyncedAt) return
      triggeredFor.current = lastSyncedAt
      mutate(undefined, {
        onSuccess: () =>
          notify('Accounts auto-synced', {
            description: 'shmoney refreshes your accounts about once a day.',
            action: { label: 'View accounts', onClick: () => navigate({ to: '/accounts' }) }
          })
      })
    }

    check()
    const id = window.setInterval(check, CHECK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [lastSyncedAt, mutate, notify, navigate])

  return null
}
