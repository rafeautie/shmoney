import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Tag01Icon
} from '@hugeicons/core-free-icons'
import { format } from 'date-fns'
import { groupSuggestions, type RuleSuggestionGroup } from '@shared/rule-suggestions'
import type { Rule, RuleConditions } from '@shared/rules'
import { useApplyRulesOnSync, useRuleSuggestionsEnabled } from '@/lib/settings'
import { useSettingsDialog } from '@/lib/settings-dialog'
import { toastUndoable } from '@/lib/undo-toast'
import { ipcErrorMessage } from '@/lib/utils'
import { invalidateRuleData } from '@/lib/invalidate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import { RuleForm, type RuleDraft } from '@/components/rules/rules-editor'
import { RulesPreviewPage } from '@/components/rules/rules-preview-page'
import { SuggestionGroupRow } from '@/components/rules/suggestion-group-row'
import {
  draftFromGroup,
  extendRule,
  useDismissSuggestions
} from '@/components/rules/suggestion-drafts'
import {
  SettingsGroup,
  SettingToggle,
  SettingAction,
  SettingsSection,
  SettingsSubpage
} from './settings-controls'

const AMT_OP_TEXT: Record<string, string> = {
  eq: 'is',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  between: 'between'
}

// plain-English one-liner for a rule row
function describeRule(conditions: RuleConditions, accountName: Map<number, string>): string[] {
  const parts: string[] = []
  const d = conditions.description
  if (d) {
    const verb = d.op === 'equals' ? 'is' : 'contains'
    parts.push(`description ${verb} ${d.phrases.map((p) => `"${p}"`).join(' or ')}`)
  }
  const a = conditions.amount
  if (a) {
    const dir = a.direction === 'in' ? 'money in ' : a.direction === 'out' ? 'money out ' : ''
    const money = (m: number): string => `$${m / 1000}`
    parts.push(
      a.op === 'between'
        ? `${dir}amount between ${money(a.value)} and ${money(a.value2 ?? a.value)}`
        : `${dir}amount ${AMT_OP_TEXT[a.op]} ${money(a.value)}`
    )
  }
  if (conditions.accountId !== undefined) {
    parts.push(`account is ${accountName.get(conditions.accountId) ?? 'unknown'}`)
  }
  const date = conditions.date
  if (date) {
    if (date.after !== undefined)
      parts.push(`on/after ${format(new Date(date.after * 1000), 'MMM d, yyyy')}`)
    if (date.before !== undefined)
      parts.push(`on/before ${format(new Date(date.before * 1000), 'MMM d, yyyy')}`)
    if (date.dayOfMonthMin !== undefined || date.dayOfMonthMax !== undefined) {
      parts.push(`day of month ${date.dayOfMonthMin ?? 1}–${date.dayOfMonthMax ?? 31}`)
    }
  }
  return parts
}

// what the rules list is editing in place: an existing rule (maybe extended with
// a suggestion group's phrases), or a new one (blank, or drafted from a group)
type Editing = { ruleId: number; extended?: Rule } | { draft: RuleDraft | null; key: string }

export function RulesSettings(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { applyRulesOnSync, setApplyRulesOnSync } = useApplyRulesOnSync()
  const { ruleSuggestionsEnabled, setRuleSuggestionsEnabled } = useRuleSuggestionsEnabled()
  const { page, open } = useSettingsDialog()

  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: () => window.api.rules.list() })
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const suggestionsQuery = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: () => window.api.ruleSuggestions.list()
  })

  const categoryName = useMemo(() => {
    const map = new Map<number, string>()
    const data = categoriesQuery.data
    if (data) {
      for (const group of data.groups) for (const c of group.categories) map.set(c.id, c.name)
      for (const c of data.ungrouped) map.set(c.id, c.name)
      for (const c of data.system) map.set(c.id, c.name)
    }
    return map
  }, [categoriesQuery.data])

  const accountName = useMemo(() => {
    const map = new Map<number, string>()
    for (const account of accountsQuery.data ?? []) map.set(account.id, account.name)
    return map
  }, [accountsQuery.data])

  const [editing, setEditing] = useState<Editing | null>(null)
  // the new-rule form opens at the end of the list, often below the fold, as can
  // a rule extended from a suggestion (and
  // Settings scrolls to the top when coming back from Suggestions), so bring it
  // into view once that has settled
  const revealNewRule = useCallback((el: HTMLDivElement | null) => {
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [])

  const rules = rulesQuery.data ?? []
  const suggestions = suggestionsQuery.data ?? []

  const reorder = useMutation({
    meta: { silenceError: true },
    mutationFn: (orderedIds: number[]) => window.api.rules.reorder({ orderedIds }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  function move(index: number, delta: number): void {
    const next = [...rules]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next.map((r) => r.id))
  }

  const back = (): void => open('rules')

  if (page === 'apply-rules') return <RulesPreviewPage onBack={back} />
  if (page === 'suggestions') {
    return (
      <SuggestionsPage
        groups={groupSuggestions(suggestions)}
        onBack={back}
        onCreateRule={(group) => {
          const existing = group.rule && rules.find((r) => r.id === group.rule!.id)
          setEditing(
            existing
              ? { ruleId: existing.id, extended: extendRule(existing, group) }
              : { draft: draftFromGroup(group), key: `sug:${group.categoryId}` }
          )
          back()
        }}
      />
    )
  }

  const newRule = editing && 'draft' in editing ? editing : null

  return (
    <SettingsSection
      title="Rules"
      description="Automatically categorize or flag transactions as they sync. Rules run top to bottom and only fill blanks, unless you choose to override existing categories when applying them manually."
      action={
        suggestions.length > 0 && (
          <Button variant="outline" onClick={() => open('rules', 'suggestions')}>
            Suggestions
            <Badge variant="secondary">{suggestions.length}</Badge>
          </Button>
        )
      }
    >
      {/* Automation options, grouped so they read apart from the rules list */}
      <SettingsGroup>
        <SettingToggle
          label="Apply rules automatically on sync"
          checked={applyRulesOnSync}
          onCheckedChange={setApplyRulesOnSync}
        />
        <SettingToggle
          label="Suggest rules from repeated categorizing"
          checked={ruleSuggestionsEnabled}
          onCheckedChange={setRuleSuggestionsEnabled}
        />
        <SettingAction
          label="Apply rules now"
          description="Run your rules against existing transactions, with a preview first."
        >
          <Button
            variant="outline"
            disabled={rules.length === 0}
            onClick={() => open('rules', 'apply-rules')}
          >
            Apply
          </Button>
        </SettingAction>
      </SettingsGroup>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Your rules</h3>
        {rulesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rules.length === 0 ? (
          <Empty className="border border-muted-foreground/30 bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Tag01Icon} />
              </EmptyMedia>
              <EmptyTitle>No rules yet</EmptyTitle>
              <EmptyDescription>
                Add a rule below to categorize or flag transactions automatically.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y rounded-lg border">
            {rules.map((rule, index) =>
              editing && 'ruleId' in editing && editing.ruleId === rule.id ? (
                // a rule extended from Suggestions can be anywhere in the list
                <div
                  key={rule.id}
                  ref={editing.extended ? revealNewRule : undefined}
                  className="scroll-mt-6"
                >
                  <RuleForm
                    inline
                    rule={editing.extended ?? rule}
                    draft={null}
                    onDone={() => setEditing(null)}
                  />
                </div>
              ) : (
                <div key={rule.id} className="px-3 py-3">
                  <RuleRow
                    rule={rule}
                    conditionText={describeRule(rule.conditions, accountName)}
                    actionText={`set category to ${categoryName.get(rule.action.categoryId) ?? 'unknown'}`}
                    isFirst={index === 0}
                    isLast={index === rules.length - 1}
                    onMoveUp={() => move(index, -1)}
                    onMoveDown={() => move(index, 1)}
                    onEdit={() => setEditing({ ruleId: rule.id })}
                  />
                </div>
              )
            )}
          </div>
        )}
        {newRule ? (
          <div ref={revealNewRule} className="scroll-mt-6 rounded-lg border">
            <RuleForm
              key={newRule.key}
              inline
              rule={null}
              draft={newRule.draft}
              onDone={() => setEditing(null)}
            />
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setEditing({ draft: null, key: 'new' })}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
            Add rule
          </Button>
        )}
      </div>

      {reorder.isError && (
        <p className="text-sm text-destructive">{ipcErrorMessage(reorder.error)}</p>
      )}
    </SettingsSection>
  )
}

/** Rules › Suggestions: pending suggestions grouped per category; each group
 *  becomes one multi-phrase rule, created in the inline editor back on Rules. */
function SuggestionsPage({
  groups,
  onBack,
  onCreateRule
}: {
  groups: RuleSuggestionGroup[]
  onBack: () => void
  onCreateRule: (group: RuleSuggestionGroup) => void
}): React.JSX.Element {
  const dismiss = useDismissSuggestions()
  return (
    <SettingsSubpage
      parent="Rules"
      title="Suggestions"
      description="You've categorized transactions like these repeatedly. Create one rule per category to do it automatically from now on; the highlighted part of each sample is what the rule will match."
      action={
        groups.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(groups.flatMap((g) => g.suggestions.map((s) => s.id)))}
          >
            Dismiss all
          </Button>
        )
      }
      onBack={onBack}
    >
      {groups.length === 0 ? (
        <Empty className="border border-muted-foreground/30 bg-background">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} />
            </EmptyMedia>
            <EmptyTitle>No suggestions</EmptyTitle>
            <EmptyDescription>
              Categorize the same merchant a few times and we&apos;ll suggest a rule here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <SuggestionGroupRow key={group.categoryId} group={group} onCreateRule={onCreateRule} />
          ))}
        </div>
      )}
    </SettingsSubpage>
  )
}

function RuleRow({
  rule,
  conditionText,
  actionText,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit
}: {
  rule: Rule
  conditionText: string[]
  actionText: string
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => window.api.rules.update({ id: rule.id, enabled }),
    onSettled: () => invalidateRuleData(queryClient)
  })
  const remove = useMutation({
    mutationFn: () => window.api.rules.delete(rule.id),
    onSuccess: (actionId) => {
      if (actionId !== null) toastUndoable(`Deleted “${rule.name}”`, actionId, queryClient)
    },
    onSettled: () => invalidateRuleData(queryClient)
  })

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{rule.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {conditionText.length > 0
            ? `If ${conditionText.join(' and ')} → ${actionText}`
            : actionText}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isFirst}
          aria-label="Move up"
          onClick={onMoveUp}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isLast}
          aria-label="Move down"
          onClick={onMoveDown}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit rule ${rule.name}`}
          onClick={onEdit}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} className="size-3.5" />
        </Button>
        {/* no confirm: the toast's Undo brings the rule back */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete rule ${rule.name}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
        </Button>
      </div>
      <Switch
        checked={rule.enabled}
        onCheckedChange={(on) => toggle.mutate(on)}
        aria-label={`Enable rule ${rule.name}`}
      />
    </div>
  )
}
