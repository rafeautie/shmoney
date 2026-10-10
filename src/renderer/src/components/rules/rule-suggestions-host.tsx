import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Rule } from '@shared/rules'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { RuleEditor, type RuleDraft } from './rules-editor'
import { draftFromGroup, extendRule } from './suggestion-drafts'

/**
 * Globally mounted rule editor for turning a suggestion group into a rule from
 * outside Settings (the Activity page), opened in place via useSuggestionsUi
 * without navigating. Settings has its own suggestions page and edits inline.
 */
export function RuleSuggestionsHost(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { registerCreateRule } = useSuggestionsUi()

  const [editorOpen, setEditorOpen] = useState(false)
  // the category's existing rule with the group's phrases added, or else a new
  // rule drafted from the group
  const [rule, setRule] = useState<Rule | null>(null)
  const [draft, setDraft] = useState<{ draft: RuleDraft; key: string } | null>(null)

  const createFromGroup = useCallback(
    async (group: RuleSuggestionGroup): Promise<void> => {
      const rules = group.rule
        ? await queryClient.fetchQuery({
            queryKey: ['rules'],
            queryFn: () => window.api.rules.list()
          })
        : []
      const existing = rules.find((r) => r.id === group.rule?.id)
      if (existing) {
        setRule(extendRule(existing, group))
        setDraft(null)
      } else {
        setRule(null)
        setDraft({
          draft: draftFromGroup(group),
          key: `sug:${group.suggestions.map((s) => s.id).join('.')}`
        })
      }
      setEditorOpen(true)
    },
    [queryClient]
  )

  useEffect(() => {
    registerCreateRule((group) => void createFromGroup(group))
  }, [registerCreateRule, createFromGroup])

  return (
    <RuleEditor
      rule={rule}
      draft={draft?.draft}
      draftKey={draft?.key}
      open={editorOpen}
      onOpenChange={(open) => {
        setEditorOpen(open)
        if (!open) {
          setRule(null)
          setDraft(null)
        }
      }}
    />
  )
}
