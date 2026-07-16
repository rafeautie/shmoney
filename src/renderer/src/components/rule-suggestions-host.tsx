import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { groupSuggestions, type RuleSuggestionGroup } from '@shared/rule-suggestions'
import { plural } from '@/lib/utils'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { RuleEditor, type RuleDraft } from './rules-editor'
import { RuleSuggestionsDialog } from './rule-suggestions-dialog'

// rule names are capped at 80 chars (ruleNameSchema); when the phrases don't
// fit, fall back to a count
function draftName(group: RuleSuggestionGroup): string {
  const joined = `${group.suggestions.map((s) => s.phrase).join(', ')} → ${group.categoryName}`
  if (joined.length <= 80) return joined
  return `${plural(group.suggestions.length, 'merchant')} → ${group.categoryName}`.slice(0, 80)
}

/**
 * Globally mounted host for the rule-suggestions dialog and the rule editor it
 * launches. Any trigger (notification action, settings card, activity feed)
 * opens it in place via useSuggestionsUi, without navigating to a page.
 */
export function RuleSuggestionsHost(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { open, setOpen, registerCreateRule } = useSuggestionsUi()

  const suggestionsQuery = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: () => window.api.ruleSuggestions.list()
  })
  const groups = groupSuggestions(suggestionsQuery.data ?? [])

  const accept = useMutation({
    mutationFn: (ids: number[]) =>
      Promise.all(ids.map((id) => window.api.ruleSuggestions.accept(id))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })

  const [editorOpen, setEditorOpen] = useState(false)
  // a suggestion group being turned into one multi-phrase rule: prefills the
  // editor, and its members are marked accepted once the rule is actually saved
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [pendingAccept, setPendingAccept] = useState<RuleSuggestionGroup | null>(null)

  const createFromGroup = useCallback(
    (group: RuleSuggestionGroup): void => {
      setOpen(false)
      setDraft({
        name: draftName(group),
        // one contains phrase per suggestion (rules OR their phrases), matching
        // how each suggestion's shown count was computed; the user can still
        // edit phrases or the op in the editor before saving
        conditions: {
          description: { op: 'contains', phrases: group.suggestions.map((s) => s.phrase) }
        },
        action: { type: 'setCategory', categoryId: group.categoryId }
      })
      setPendingAccept(group)
      setEditorOpen(true)
    },
    [setOpen]
  )

  // let triggers elsewhere (e.g. the Activity page) send a group straight to
  // the editor, bypassing the dialog
  useEffect(() => {
    registerCreateRule(createFromGroup)
  }, [registerCreateRule, createFromGroup])

  return (
    <>
      <RuleSuggestionsDialog open={open} onOpenChange={setOpen} groups={groups} />
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
          if (!wasCreate || !pendingAccept) return
          // accept only what the saved rule still covers: the user may have
          // removed phrases or retargeted the category in the editor, and those
          // suggestions should stay pending rather than vanish as "accepted"
          if (saved.action.categoryId !== pendingAccept.categoryId) return
          const kept = new Set(
            (saved.conditions.description?.phrases ?? []).map((p) => p.toLowerCase())
          )
          const ids = pendingAccept.suggestions
            .filter((s) => kept.has(s.phrase.toLowerCase()))
            .map((s) => s.id)
          if (ids.length > 0) accept.mutate(ids)
        }}
      />
    </>
  )
}
