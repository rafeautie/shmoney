import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RuleSuggestion } from '@shared/rule-suggestions'
import { useSettings } from '@/lib/settings'

export function useRuleSuggestions() {
  return useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: () => window.api.ruleSuggestions.list()
  })
}

function useNewestAutomatedAt() {
  return useQuery({
    queryKey: ['actionLog', 'newestAutomated'],
    queryFn: () => window.api.actionLog.newestAutomatedAt()
  })
}

// changes the app made on its own, plus the rule suggestions it came up with;
// the user's own edits never need a heads-up
function newestAutomated(
  newestEntryAt: number | null | undefined,
  suggestions: RuleSuggestion[] | undefined
): number | null {
  let newest = newestEntryAt ?? null
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
  const newest = newestAutomated(useNewestAutomatedAt().data, useRuleSuggestions().data)
  return isUnseen(newest, settings.activitySeenAt)
}

/** Mounted by the Activity page: marks everything as seen, including entries that arrive while it's open. */
export function useMarkActivitySeen(): void {
  const { settings, setSetting } = useSettings()
  const newest = newestAutomated(useNewestAutomatedAt().data, useRuleSuggestions().data)
  const seenAt = settings.activitySeenAt
  useEffect(() => {
    if (newest !== null && isUnseen(newest, seenAt)) setSetting('activitySeenAt', newest)
  }, [newest, seenAt, setSetting])
}
