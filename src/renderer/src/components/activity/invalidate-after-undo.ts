import type { QueryClient } from '@tanstack/react-query'
import type { ActionDomain, ActionLogEntry } from '@shared/ipc'
import { invalidateCategoryData, invalidateTransactionData } from '@/lib/invalidate'
import { CHAT_CONVERSATIONS_KEY } from '@/lib/chat'

const DOMAIN_KEYS: Record<
  Exclude<ActionDomain, 'transactions' | 'categories'>,
  readonly unknown[]
> = {
  budgets: ['budget-summary'],
  goals: ['goals'],
  conversations: CHAT_CONVERSATIONS_KEY,
  savedFilters: ['saved-filters'],
  rules: ['rules']
}

/** After undoing or redoing entries, refetch only what they touched. */
export function invalidateAfterUndo(queryClient: QueryClient, entries: ActionLogEntry[]): void {
  const domains = new Set(entries.flatMap((e) => e.domains))
  // a category restore reaches transactions, budgets, reports and rules alike
  if (domains.has('categories')) void invalidateCategoryData(queryClient)
  // the transaction set already covers the log, budgets and goals
  else if (domains.has('transactions')) void invalidateTransactionData(queryClient)
  else void queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  for (const domain of domains) {
    if (domain !== 'transactions' && domain !== 'categories')
      void queryClient.invalidateQueries({ queryKey: DOMAIN_KEYS[domain] })
  }
}
