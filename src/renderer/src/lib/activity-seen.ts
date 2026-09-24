import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ActionLogEntry } from '@shared/ipc'
import type { RuleSuggestion } from '@shared/rule-suggestions'
import { actionLogOptions } from '@/lib/queries'
import { useSettings } from '@/lib/settings'

export function useRuleSuggestions() {
  return useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: () => window.api.ruleSuggestions.list()
  })
}

// changes the app made on its own, plus the rule suggestions it came up with;
// the user's own edits never need a heads-up
function newestAutomated(
  entries: ActionLogEntry[] | undefined,
  suggestions: RuleSuggestion[] | undefined
): number | null {
  let newest: number | null = null
  for (const e of entries ?? []) {
    if (e.source === 'user' || e.source === 'import') continue
    if (newest === null || e.createdAt > newest) newest = e.createdAt
  }
  for (const s of suggestions ?? []) {
    if (newest === null || s.createdAt > newest) newest = s.createdAt
  }
  return newest
}

function isUnseen(newest: number | null, seenAt: number | null): boolean {
  return newest !== null && (seenAt === null || newest > seenAt)
}

/** True when an automated change or a rule suggestion landed after the user last opened Activity. */
export function useUnseenActivity(): boolean {
  const { settings } = useSettings()
  const newest = newestAutomated(useQuery(actionLogOptions).data, useRuleSuggestions().data)
  return isUnseen(newest, settings.activitySeenAt)
}

/** Mounted by the Activity page: marks everything it shows as seen, including entries that arrive while it's open. */
export function useMarkActivitySeen(
  entries: ActionLogEntry[] | undefined,
  suggestions: RuleSuggestion[] | undefined
): void {
  const { settings, setSetting } = useSettings()
  const newest = newestAutomated(entries, suggestions)
  const seenAt = settings.activitySeenAt
  useEffect(() => {
    if (newest !== null && isUnseen(newest, seenAt)) setSetting('activitySeenAt', newest)
  }, [newest, seenAt, setSetting])
}
