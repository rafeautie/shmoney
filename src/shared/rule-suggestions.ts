// Recommended rules: when the same description gets categorized the same way
// repeatedly (by the user or auto-categorize), the detector suggests turning it
// into a rule. Suggestions surface transiently in the notification center and
// live in the Settings rules card and Activity page until accepted or
// dismissed. Neither is forever: categorizing the cluster again re-suggests a
// dismissed pair, and deleting the accepted rule re-suggests its pair.

export interface RuleSuggestion {
  id: number
  /** the exact transaction description the cluster shares */
  descriptionKey: string
  categoryId: number
  categoryName: string
  /** current count of matching transactions (recomputed on list) */
  matchCount: number
  source: 'user' | 'llm'
  createdAt: number
}

/** payload of the main→renderer event fired when new suggestions are created */
export interface RuleSuggestionsCreatedEvent {
  count: number
}

export const RULE_SUGGESTIONS_IPC = {
  list: 'ruleSuggestions:list',
  dismiss: 'ruleSuggestions:dismiss',
  accept: 'ruleSuggestions:accept'
} as const

export const RULE_SUGGESTIONS_CREATED = 'ruleSuggestions:created'
