import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Rule } from '@shared/rules'
import { plural } from '@/lib/utils'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'
import type { RuleDraft } from './rules-editor'

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

/** Once a rule made from a suggestion group is saved, mark accepted only what the
 *  saved rule still covers: the user may have removed phrases or retargeted the
 *  category, and those suggestions should stay pending rather than vanish. */
export function useAcceptCoveredSuggestions(): (saved: Rule, group: RuleSuggestionGroup) => void {
  const queryClient = useQueryClient()
  const accept = useMutation({
    mutationFn: (ids: number[]) =>
      Promise.all(ids.map((id) => window.api.ruleSuggestions.accept(id))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })
  return (saved, group) => {
    if (saved.action.categoryId !== group.categoryId) return
    const kept = new Set((saved.conditions.description?.phrases ?? []).map((p) => p.toLowerCase()))
    const ids = group.suggestions.filter((s) => kept.has(s.phrase.toLowerCase())).map((s) => s.id)
    if (ids.length > 0) accept.mutate(ids)
  }
}
