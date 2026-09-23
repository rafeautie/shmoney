import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ActionLogEntry } from '@shared/ipc'
import { actionLogOptions } from '@/lib/queries'
import { useSettings } from '@/lib/settings'

// changes the app made on its own; the user's own edits never need a heads-up
function newestAutomated(entries: ActionLogEntry[] | undefined): number | null {
  let newest: number | null = null
  for (const e of entries ?? []) {
    if (e.source === 'user' || e.source === 'import') continue
    if (newest === null || e.createdAt > newest) newest = e.createdAt
  }
  return newest
}

/** True when an automated change landed after the user last opened Activity. */
export function useUnseenActivity(): boolean {
  const { settings } = useSettings()
  const newest = newestAutomated(useQuery(actionLogOptions).data)
  return newest !== null && (settings.activitySeenAt === null || newest > settings.activitySeenAt)
}

/** Mounted by the Activity page: marks everything it shows as seen, including entries that arrive while it's open. */
export function useMarkActivitySeen(entries: ActionLogEntry[] | undefined): void {
  const { settings, setSetting } = useSettings()
  const newest = newestAutomated(entries)
  const seenAt = settings.activitySeenAt
  useEffect(() => {
    if (newest !== null && (seenAt === null || newest > seenAt))
      setSetting('activitySeenAt', newest)
  }, [newest, seenAt, setSetting])
}
