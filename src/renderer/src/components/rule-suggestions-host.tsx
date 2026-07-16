import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RuleSuggestion } from '@shared/rule-suggestions'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { RuleEditor, type RuleDraft } from './rules-editor'
import { RuleSuggestionsDialog } from './rule-suggestions-dialog'

/**
 * Globally mounted host for the rule-suggestions dialog and the rule editor it
 * launches. Any trigger (notification action, settings card, activity feed)
 * opens it in place via useSuggestionsUi, without navigating to a page.
 */
export function RuleSuggestionsHost(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { open, setOpen } = useSuggestionsUi()

  const suggestionsQuery = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: () => window.api.ruleSuggestions.list()
  })
  const suggestions = suggestionsQuery.data ?? []

  const accept = useMutation({
    mutationFn: (id: number) => window.api.ruleSuggestions.accept(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })
  const dismiss = useMutation({
    mutationFn: (id: number) => window.api.ruleSuggestions.dismiss(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })

  const [editorOpen, setEditorOpen] = useState(false)
  // a suggestion being turned into a rule: prefills the editor, and its id is
  // marked accepted once the rule is actually saved
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [pendingAcceptId, setPendingAcceptId] = useState<number | null>(null)

  function createFromSuggestion(suggestion: RuleSuggestion): void {
    setOpen(false)
    setDraft({
      name: `${suggestion.descriptionKey} → ${suggestion.categoryName}`,
      // equals so the shown count matches the rule's real reach; the user can
      // switch to "contains" in the editor before saving
      conditions: { description: { op: 'equals', phrases: [suggestion.descriptionKey] } },
      action: { type: 'setCategory', categoryId: suggestion.categoryId }
    })
    setPendingAcceptId(suggestion.id)
    setEditorOpen(true)
  }

  return (
    <>
      <RuleSuggestionsDialog
        open={open}
        onOpenChange={setOpen}
        suggestions={suggestions}
        onCreate={createFromSuggestion}
        onDismiss={(id) => dismiss.mutate(id)}
        dismissingId={dismiss.isPending ? dismiss.variables : undefined}
      />
      <RuleEditor
        rule={null}
        draft={draft}
        draftKey={pendingAcceptId != null ? `sug:${pendingAcceptId}` : undefined}
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setDraft(null)
            setPendingAcceptId(null)
          }
        }}
        onSaved={(_saved, wasCreate) => {
          if (wasCreate && pendingAcceptId != null) accept.mutate(pendingAcceptId)
        }}
      />
    </>
  )
}
