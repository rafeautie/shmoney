import { useCallback, useEffect, useState } from 'react'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { RuleEditor, type RuleDraft } from './rules-editor'
import { draftFromGroup, useAcceptCoveredSuggestions } from './use-accept-suggestions'

/**
 * Globally mounted rule editor for turning a suggestion group into a rule from
 * outside Settings (the Activity page), opened in place via useSuggestionsUi
 * without navigating. Settings has its own suggestions page and edits inline.
 */
export function RuleSuggestionsHost(): React.JSX.Element {
  const { registerCreateRule } = useSuggestionsUi()
  const acceptCovered = useAcceptCoveredSuggestions()

  const [editorOpen, setEditorOpen] = useState(false)
  // a suggestion group being turned into one multi-phrase rule: prefills the
  // editor, and its members are marked accepted once the rule is actually saved
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [pendingAccept, setPendingAccept] = useState<RuleSuggestionGroup | null>(null)

  const createFromGroup = useCallback((group: RuleSuggestionGroup): void => {
    setDraft(draftFromGroup(group))
    setPendingAccept(group)
    setEditorOpen(true)
  }, [])

  useEffect(() => {
    registerCreateRule(createFromGroup)
  }, [registerCreateRule, createFromGroup])

  return (
    <RuleEditor
      rule={null}
      draft={draft}
      draftKey={
        pendingAccept ? `sug:${pendingAccept.suggestions.map((s) => s.id).join('.')}` : undefined
      }
      open={editorOpen}
      onOpenChange={(open) => {
        setEditorOpen(open)
        if (!open) {
          setDraft(null)
          setPendingAccept(null)
        }
      }}
      onSaved={(saved, wasCreate) => {
        if (wasCreate && pendingAccept) acceptCovered(saved, pendingAccept)
      }}
    />
  )
}
