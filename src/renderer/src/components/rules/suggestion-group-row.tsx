import type { RuleSuggestionGroup } from '@shared/rule-suggestions'
import { plural } from '@/lib/utils'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { Button } from '@/components/ui/button'
import { useDismissSuggestions } from './suggestion-drafts'
import { SettingAction, SettingsGroup } from '@/components/settings/settings-controls'

// The sample description with the rule phrase highlighted in place: what the
// rule matches on is visible in context at a glance, instead of phrase and
// sample being described to each other in a sentence.
export function MatchSample({
  phrase,
  description
}: {
  phrase: string
  description: string
}): React.JSX.Element {
  const mark = (text: string) => (
    <span className="rounded-sm bg-primary/15 px-1 py-0.5 font-medium text-foreground">{text}</span>
  )
  const idx = description.toLowerCase().indexOf(phrase.toLowerCase())
  if (idx === -1) {
    // the model's phrase isn't verbatim in the sample (possible while raw
    // extraction is unvetted): show both rather than a broken highlight
    return (
      <>
        {mark(phrase)}
        <span> · e.g. &quot;{description}&quot;</span>
      </>
    )
  }
  return (
    <>
      {description.slice(0, idx)}
      {mark(description.slice(idx, idx + phrase.length))}
      {description.slice(idx + phrase.length)}
    </>
  )
}

/**
 * One per-category group of pending rule suggestions on the Settings suggestions page
 * (Activity lists the same groups compactly), as a settings-style block
 * (SettingsGroup): a header row with the category and the group's actions,
 * then one divided row per match — the raw sample in monospace with the
 * extracted phrase highlighted, and the reach as a right-aligned count.
 * Create rule sends the whole group to a rule editor (one rule, all phrases
 * as contains matches) where unwanted phrases can be removed: Settings' inline
 * one via onCreateRule, else the global one. When the category already has a
 * rule, Add to rule opens that rule with the phrases added instead. Dismiss
 * drops the group.
 */
export function SuggestionGroupRow({
  group,
  onCreateRule
}: {
  group: RuleSuggestionGroup
  /** where Create rule sends the group; defaults to the global rule editor */
  onCreateRule?: (group: RuleSuggestionGroup) => void
}): React.JSX.Element {
  const { createRule: createInEditor } = useSuggestionsUi()
  const createRule = onCreateRule ?? createInEditor
  const dismiss = useDismissSuggestions()

  return (
    <SettingsGroup>
      <SettingAction
        label={<span className="truncate text-sm font-medium">{group.categoryName}</span>}
        description={
          group.rule && (
            <span className="block truncate" title={group.rule.name}>
              Adds to “{group.rule.name}”
            </span>
          )
        }
      >
        {/* min-w-20 keeps the pair the same width */}
        <Button size="sm" className="min-w-20" onClick={() => createRule(group)}>
          {group.rule ? 'Add to rule' : 'Create rule'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-20"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(group.suggestions.map((s) => s.id))}
        >
          Dismiss
        </Button>
      </SettingAction>
      {group.suggestions.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            <MatchSample phrase={s.phrase} description={s.descriptionKey} />
          </div>
          {/* no per-match controls: unwanted phrases are removed in the editor
              after Create rule, and Dismiss drops the whole group */}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {plural(s.matchCount, 'transaction')}
          </span>
        </div>
      ))}
    </SettingsGroup>
  )
}
