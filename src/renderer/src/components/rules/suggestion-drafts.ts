import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Rule } from '@shared/rules'
import { plural } from '@/lib/utils'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'
import type { RuleDraft } from './rules-editor'

// Saving the rule is what accepts the suggestions: the main process marks every
// pending suggestion a saved rule covers, so phrases removed in the editor (or a
// retargeted category) stay pending.

// rule names are capped at 80 chars (ruleNameSchema); when the phrases don't
// fit, fall back to a count
function draftName(group: RuleSuggestionGroup): string {
  const joined = `${group.suggestions.map((s) => s.phrase).join(', ')} → ${group.categoryName}`
  if (joined.length <= 80) return joined
  return `${plural(group.suggestions.length, 'merchant')} → ${group.categoryName}`.slice(0, 80)
}

/** A suggestion group as a new rule: one contains phrase per suggestion (rules
 *  OR their phrases), matching how each suggestion's count was computed. */
export function draftFromGroup(group: RuleSuggestionGroup): RuleDraft {
  return {
    name: draftName(group),
    conditions: {
      description: { op: 'contains', phrases: group.suggestions.map((s) => s.phrase) }
    },
    action: { type: 'setCategory', categoryId: group.categoryId }
  }
}

/** The category's existing rule with the group's phrases added, to edit and save. */
export function extendRule(rule: Rule, group: RuleSuggestionGroup): Rule {
  const phrases = rule.conditions.description?.phrases ?? []
  const have = new Set(phrases.map((p) => p.toLowerCase()))
  const added = group.suggestions.map((s) => s.phrase).filter((p) => !have.has(p.toLowerCase()))
  return {
    ...rule,
    conditions: {
      ...rule.conditions,
      description: { op: 'contains', phrases: [...phrases, ...added] }
    }
  }
}

/** Dismiss suggestions by id; a dismissed pair comes back if categorized again. */
export function useDismissSuggestions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) =>
      Promise.all(ids.map((id) => window.api.ruleSuggestions.dismiss(id))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })
}
