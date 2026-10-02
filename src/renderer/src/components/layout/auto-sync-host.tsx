import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnectSimpleFin } from '@/hooks/use-connect-simplefin'
import { connectionOptions } from '@/lib/queries'

const DAY_MS = 24 * 60 * 60 * 1000

// how often, while the app is open, we re-check whether a day has elapsed. A
// plain timestamp comparison, so this is cheap; a coarse interval is enough to
// catch the 24h mark being crossed mid-session, and it survives sleep/wake
// because the check reads the wall clock rather than counting ticks.
const CHECK_INTERVAL_MS = 30 * 60 * 1000

// a launch sync competes with the first screens for the main process, so it
// waits until the app has settled
const LAUNCH_DELAY_MS = 10_000
const launchedAt = Date.now()

/**
 * Mounted once at the root: keeps the connection synced roughly daily. It fires
 * a background sync when more than 24h have passed since the last successful one
 * (connection.lastSyncedAt) — about 10s after launch if the app was closed across
 * that mark, and on a coarse interval so an app left open still syncs when the
 * mark is crossed. Reuses the same sync path as the manual button, so transfer
 * detection, rules, and query invalidation all run; what it changed shows up
 * on the Activity dot.
 */
export function AutoSyncHost(): null {
  const { syncConnection } = useConnectSimpleFin()
  const { mutate } = syncConnection

  const { data: connection } = useQuery(connectionOptions)
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
      mutate()
    }

    const first = window.setTimeout(check, launchedAt + LAUNCH_DELAY_MS - Date.now())
    const id = window.setInterval(check, CHECK_INTERVAL_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [lastSyncedAt, mutate])

  return null
}
