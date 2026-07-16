// Recommended rules: when the same description gets categorized the same way
// repeatedly (by the user or auto-categorize), the detector suggests turning it
// into a rule — matching on a model-extracted merchant term when one is
// available, or the exact description otherwise. Suggestions surface
// transiently in the notification center and live in the Settings rules card
// and Activity page until accepted or dismissed. Neither is forever:
// categorizing the cluster again re-suggests a dismissed pair, and deleting
// the accepted rule re-suggests its pair.

export interface RuleSuggestion {
  id: number
  /** the exact description of the cluster that triggered the suggestion (the sample shown) */
  descriptionKey: string
  /** the term the suggested `contains` rule matches on; the exact description when nothing was extracted */
  phrase: string
  categoryId: number
  categoryName: string
  /** current count of matching transactions (recomputed on list) */
  matchCount: number
  source: 'user' | 'llm'
  createdAt: number
}

// Rules OR their phrases, so all of a category's pending suggestions belong in
// ONE rule with multiple contains phrases, not one rule each. The surfaces
// therefore display per-category groups, and accepting a group creates a
// single multi-phrase rule.
export interface RuleSuggestionGroup {
  categoryId: number
  categoryName: string
  /** at least one; keeps the list's matchCount-desc order */
  suggestions: RuleSuggestion[]
}

/** Fold the flat pending list into per-category groups, preserving order. */
export function groupSuggestions(suggestions: RuleSuggestion[]): RuleSuggestionGroup[] {
  const byCategory = new Map<number, RuleSuggestionGroup>()
  for (const s of suggestions) {
    const group = byCategory.get(s.categoryId)
    if (group) group.suggestions.push(s)
    else {
      byCategory.set(s.categoryId, {
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        suggestions: [s]
      })
    }
  }
  return [...byCategory.values()]
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
