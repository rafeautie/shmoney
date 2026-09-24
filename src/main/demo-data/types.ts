import type { DemoDataset } from '@shared/demo'
import type { ReportCreateInput } from '@shared/reports'
import type { Settings } from '@shared/settings'
import type { TransactionFilters } from '@shared/transaction-filters'
import type { SfinAccountSet } from '../simplefin'
import type { Turn } from './chat'

/** A category by display name, or a system category by key. */
export type CategoryRef = string | { system: 'income' | 'transfers' }

/**
 * Filters with categories named rather than numbered; ids only exist once the
 * seed has reset the category table.
 */
export type NamedFilters<F> = Omit<F, 'categoryIds'> & { categories?: CategoryRef[] }

export interface DatasetDefinition extends DemoDataset {
  /** the demo SimpleFIN bridge's /accounts payload, anchored to `now` */
  accountSet(now: Date): SfinAccountSet
  /** created before the first sync, so rules-on-sync files most rows */
  rules?: { name: string; phrases: string[]; category: CategoryRef }[]
  /**
   * Description phrases the imaginary user categorized by hand, applied to
   * rows older than `olderThanDays`. Newer rows stay uncategorized for the
   * visitor to try.
   */
  manual?: { olderThanDays: number; entries: { phrase: string; category: CategoryRef }[] }
  /** envelope fills in dollars, keyed by months-ago the fill starts */
  budgets?: { category: string; fills: { monthsAgo: number; amount: number }[] }[]
  reports?: (Omit<ReportCreateInput, 'widgets'> & {
    widgets?: (NonNullable<ReportCreateInput['widgets']>[number] & {
      categories?: CategoryRef[]
    })[]
  })[]
  savedFilters?: { name: string; filters: NamedFilters<TransactionFilters> }[]
  suggestions?: { phrase: string; category: CategoryRef }[]
  chats?: ChatScript[]
  settings?: Partial<Settings>
}

export interface ChatScript {
  question: string
  hoursAgo: number
  answer(turn: Turn): void
}
