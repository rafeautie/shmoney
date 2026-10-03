import type { QueryClient } from '@tanstack/react-query'
import type { ActionDomain, ActionLogEntry } from '@shared/ipc'
import { invalidateTransactionData } from '@/lib/invalidate'
import { CHAT_CONVERSATIONS_KEY } from '@/lib/chat'

const DOMAIN_KEYS: Record<Exclude<ActionDomain, 'transactions'>, readonly unknown[]> = {
  budgets: ['budget-summary'],
  goals: ['goals'],
  conversations: CHAT_CONVERSATIONS_KEY,
  savedFilters: ['saved-filters']
}

/** After undoing or redoing entries, refetch only what they touched. */
export function invalidateAfterUndo(queryClient: QueryClient, entries: ActionLogEntry[]): void {
  const domains = new Set(entries.flatMap((e) => e.domains))
  // the transaction set already covers the log, budgets and goals
  if (domains.has('transactions')) void invalidateTransactionData(queryClient)
  else void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  for (const domain of domains) {
    if (domain !== 'transactions')
      void queryClient.invalidateQueries({ queryKey: DOMAIN_KEYS[domain] })
  }
}
