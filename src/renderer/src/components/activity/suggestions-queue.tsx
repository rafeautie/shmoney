import { groupSuggestions, type RuleSuggestion } from '@shared/rule-suggestions'
import { plural } from '@/lib/utils'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { Button } from '@/components/ui/button'
import { MatchSample } from '@/components/rules/suggestion-group-row'
import { useDismissSuggestions } from '@/components/rules/suggestion-drafts'

/**
 * Pending rule suggestions, one line per category: the top match with its
 * phrase highlighted, the group's reach, and its actions. Lives apart from the
 * history so dismissing one never touches the record below. Every phrase is
 * reviewable in the rule editor that Create rule opens.
 */
export function SuggestionsQueue({ suggestions }: { suggestions: RuleSuggestion[] }) {
  const { createRule } = useSuggestionsUi()
  const groups = groupSuggestions(suggestions)
  const dismiss = useDismissSuggestions()

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-4">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
          Needs review
          <span className="text-xs font-normal text-muted-foreground">
            {plural(suggestions.length, 'rule suggestion')}
          </span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(suggestions.map((s) => s.id))}
        >
          Dismiss all
        </Button>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border">
        {groups.map((group) => {
          const [top, ...rest] = group.suggestions
          const reach = group.suggestions.reduce((n, s) => n + s.matchCount, 0)
          return (
            <div
              key={group.categoryId}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 bg-background py-2 pr-3 pl-4"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {group.categoryName}
                  {group.rule && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · adds to “{group.rule.name}”
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  <MatchSample phrase={top.phrase} description={top.descriptionKey} />
                  {rest.length > 0 && ` · +${plural(rest.length, 'more phrase')}`}
                </div>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {plural(reach, 'transaction')}
              </span>
              <div className="flex gap-1">
                {/* min-w-20 keeps the pair the same width */}
                <Button className="min-w-20" onClick={() => createRule(group)}>
                  {group.rule ? 'Add to rule' : 'Create rule'}
                </Button>
                <Button
                  variant="ghost"
                  className="min-w-20"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(group.suggestions.map((s) => s.id))}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
