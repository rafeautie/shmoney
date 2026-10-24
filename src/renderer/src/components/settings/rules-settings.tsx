import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Tag01Icon
} from '@hugeicons/core-free-icons'
import { format } from 'date-fns'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { groupSuggestions, type RuleSuggestionGroup } from '@shared/rule-suggestions'
import type { Rule, RuleConditions } from '@shared/rules'
import { useApplyRulesOnSync, useRuleSuggestionsEnabled } from '@/lib/settings'
import { useSettingsDialog } from '@/lib/settings-dialog'
import { toastUndoable } from '@/lib/undo-toast'
import { cn, ipcErrorMessage } from '@/lib/utils'
import { invalidateRuleData } from '@/lib/invalidate'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import { RuleForm, type RuleDraft } from '@/components/rules/rules-editor'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'
import { RULE_FORM_DESCRIPTION, ruleFormTitle } from '@/components/rules/rule-form-labels'
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

// what the edit sub-page is showing: an existing rule (maybe extended with a
// suggestion group's phrases), or a new one (blank, or drafted from a group)
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
  // the sub-page replaces the list in the same scroll area, which may be
  // scrolled down to the rule that was picked; start the page at its top
  const revealPage = useCallback((el: HTMLElement | null) => {
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [])

  const rules = rulesQuery.data ?? []
  const suggestions = suggestionsQuery.data ?? []

  const reorder = useMutation({
    meta: { silenceError: true },
    mutationFn: (orderedIds: number[]) => window.api.rules.reorder({ orderedIds }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  // a few pixels of travel before a drag starts, so clicks on the handle stay clicks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function moveRule(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || to >= rules.length) return
    const next = arrayMove(rules, from, to)
    // show the new order right away instead of snapping back until the refetch
    queryClient.setQueryData<Rule[]>(['rules'], next)
    reorder.mutate(next.map((r) => r.id))
  }

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (!over) return
    moveRule(
      rules.findIndex((r) => r.id === active.id),
      rules.findIndex((r) => r.id === over.id)
    )
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

  if (editing) {
    const rule =
      'ruleId' in editing
        ? (editing.extended ?? rules.find((r) => r.id === editing.ruleId) ?? null)
        : null
    return (
      <div ref={revealPage} className="scroll-mt-6">
        <SettingsSubpage
          parent="Rules"
          title={ruleFormTitle(rule)}
          description={RULE_FORM_DESCRIPTION}
          onBack={() => setEditing(null)}
        >
          <div className="rounded-lg border">
            <RuleForm
              key={'ruleId' in editing ? editing.ruleId : editing.key}
              inline
              rule={rule}
              draft={'draft' in editing ? editing.draft : null}
              onDone={() => setEditing(null)}
            />
          </div>
        </SettingsSubpage>
      </div>
    )
  }

  return (
    <SettingsSection
      title="Rules"
      description="Automatically categorize or flag transactions as they sync. Rules run top to bottom (drag one to change its place) and only fill blanks, unless you choose to override existing categories when applying them manually."
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
          label="Apply Rules Now"
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
        <h3 className="text-sm font-medium">Your Rules</h3>
        {rulesQuery.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rules.length === 0 ? (
          <Empty className="border border-muted-foreground/30 bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Tag01Icon} />
              </EmptyMedia>
              <EmptyTitle>No Rules Yet</EmptyTitle>
              <EmptyDescription>
                Add a rule below to categorize or flag transactions automatically.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[verticalOnly]}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  'Use the arrow keys to move this rule up or down, or drag it with the mouse.'
              }
            }}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y rounded-lg border">
                {rules.map((rule, index) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    conditionText={describeRule(rule.conditions, accountName)}
                    actionText={`set category to ${categoryName.get(rule.action.categoryId) ?? 'unknown'}`}
                    onMove={(delta) => moveRule(index, index + delta)}
                    onEdit={() => setEditing({ ruleId: rule.id })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setEditing({ draft: null, key: 'new' })}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
          Add Rule
        </Button>
      </div>

      {reorder.isError && (
        <p className="text-sm text-destructive">{ipcErrorMessage(reorder.error)}</p>
      )}
    </SettingsSection>
  )
}

/** Rules › Suggestions: pending suggestions grouped per category; each group
 *  becomes one multi-phrase rule, created on the rule sub-page. */
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
            Dismiss All
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
            <EmptyTitle>No Suggestions</EmptyTitle>
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

// rules only reorder up and down
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

function RuleRow({
  rule,
  conditionText,
  actionText,
  onMove,
  onEdit
}: {
  rule: Rule
  conditionText: string[]
  actionText: string
  onMove: (delta: number) => void
  onEdit: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: rule.id })
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
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative flex items-center gap-3 bg-background py-3 pr-3 pl-1 first:rounded-t-lg last:rounded-b-lg',
        isDragging && 'z-10 rounded-lg shadow-md ring-1 ring-border'
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon-sm"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={`Reorder rule ${rule.name}`}
        title="Drag to reorder, or use the arrow keys"
        {...attributes}
        {...listeners}
        // arrow keys move the focused rule a step, the keyboard stand-in for dragging
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          onMove(e.key === 'ArrowUp' ? -1 : 1)
        }}
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} className="size-3.5" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{rule.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {conditionText.length > 0
            ? `If ${conditionText.join(' and ')} → ${actionText}`
            : actionText}
        </div>
      </div>
      <Switch
        checked={rule.enabled}
        onCheckedChange={(on) => toggle.mutate(on)}
        aria-label={`Enable rule ${rule.name}`}
      />
      {/* no confirm on Delete: the toast's Undo brings the rule back */}
      <ActionsMenu label="Rule Actions">
        <ActionsMenuItem icon={PencilEdit01Icon} onClick={onEdit}>
          Edit
        </ActionsMenuItem>
        <ActionsMenuItem
          icon={Delete02Icon}
          destructive
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete
        </ActionsMenuItem>
      </ActionsMenu>
    </div>
  )
}
