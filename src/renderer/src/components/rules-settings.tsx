import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Tag01Icon
} from '@hugeicons/core-free-icons'
import { format } from 'date-fns'
import type { Rule, RuleConditions } from '@shared/rules'
import type { RuleSuggestion } from '@shared/rule-suggestions'
import { useApplyRulesOnSync, useRuleSuggestionsEnabled } from '@/lib/settings'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { ipcErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { ConfirmDialog } from './confirm-dialog'
import { RuleEditor, type RuleDraft } from './rules-editor'
import { RulesPreviewDialog } from './rules-preview-dialog'
import { RuleSuggestionsDialog } from './rule-suggestions-dialog'
import { SettingsGroup, SettingToggle, SettingAction } from './settings-controls'

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
    if (date.after !== undefined) parts.push(`on/after ${format(new Date(date.after * 1000), 'MMM d, yyyy')}`)
    if (date.before !== undefined) parts.push(`on/before ${format(new Date(date.before * 1000), 'MMM d, yyyy')}`)
    if (date.dayOfMonthMin !== undefined || date.dayOfMonthMax !== undefined) {
      parts.push(`day of month ${date.dayOfMonthMin ?? 1}–${date.dayOfMonthMax ?? 31}`)
    }
  }
  return parts
}

export function RulesSettings(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { applyRulesOnSync, setApplyRulesOnSync } = useApplyRulesOnSync()
  const { ruleSuggestionsEnabled, setRuleSuggestionsEnabled } = useRuleSuggestionsEnabled()
  const { open: suggestionsOpen, setOpen: setSuggestionsOpen } = useSuggestionsUi()

  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: () => window.api.rules.list() })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => window.api.categories.list() })
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => window.api.accounts.list() })
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
    }
    return map
  }, [categoriesQuery.data])

  const accountName = useMemo(() => {
    const map = new Map<number, string>()
    for (const account of accountsQuery.data ?? []) map.set(account.id, account.name)
    return map
  }, [accountsQuery.data])

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  // a suggestion being turned into a rule: prefills the editor, and its id is
  // marked accepted once the rule is actually saved
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [pendingAcceptId, setPendingAcceptId] = useState<number | null>(null)

  const rules = rulesQuery.data ?? []
  const suggestions = suggestionsQuery.data ?? []

  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) => window.api.rules.reorder({ orderedIds }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  const accept = useMutation({
    mutationFn: (id: number) => window.api.ruleSuggestions.accept(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })
  const dismiss = useMutation({
    mutationFn: (id: number) => window.api.ruleSuggestions.dismiss(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
  })

  function createFromSuggestion(suggestion: RuleSuggestion): void {
    setSuggestionsOpen(false)
    setEditingRule(null)
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

  function move(index: number, delta: number): void {
    const next = [...rules]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next.map((r) => r.id))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rules</CardTitle>
        <CardDescription>
          Automatically categorize or flag transactions as they sync. Rules run top to bottom and
          only fill blanks, unless you choose to override existing categories when applying them
          manually.
        </CardDescription>
        {suggestions.length > 0 && (
          <CardAction>
            <Button variant="outline" onClick={() => setSuggestionsOpen(true)}>
              Suggestions
              <Badge variant="secondary">{suggestions.length}</Badge>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
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
              onClick={() => setPreviewOpen(true)}
              disabled={rules.length === 0}
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
              {rules.map((rule, index) => (
                <div key={rule.id} className="px-3 py-3">
                  <RuleRow
                    rule={rule}
                    conditionText={describeRule(rule.conditions, accountName)}
                    actionText={
                      rule.action.type === 'markTransfer'
                        ? 'mark as transfer'
                        : `set category to ${categoryName.get(rule.action.categoryId) ?? 'unknown'}`
                    }
                    isFirst={index === 0}
                    isLast={index === rules.length - 1}
                    onMoveUp={() => move(index, -1)}
                    onMoveDown={() => move(index, 1)}
                    onEdit={() => {
                      setEditingRule(rule)
                      setEditorOpen(true)
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setEditingRule(null)
              setEditorOpen(true)
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
            Add rule
          </Button>
        </div>

        {reorder.isError && (
          <p className="text-sm text-destructive">{ipcErrorMessage(reorder.error)}</p>
        )}
      </CardContent>

      <RuleEditor
        rule={editingRule}
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
      <RulesPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
      <RuleSuggestionsDialog
        open={suggestionsOpen}
        onOpenChange={setSuggestionsOpen}
        suggestions={suggestions}
        onCreate={createFromSuggestion}
        onDismiss={(id) => dismiss.mutate(id)}
        dismissingId={dismiss.isPending ? dismiss.variables : undefined}
      />
    </Card>
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
  const [confirmOpen, setConfirmOpen] = useState(false)

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => window.api.rules.update({ id: rule.id, enabled }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })
  const remove = useMutation({
    mutationFn: () => window.api.rules.delete(rule.id),
    onSuccess: () => setConfirmOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{rule.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {conditionText.length > 0 ? `If ${conditionText.join(' and ')} → ${actionText}` : actionText}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <Button variant="ghost" size="icon-sm" disabled={isFirst} aria-label="Move up" onClick={onMoveUp}>
          <HugeiconsIcon icon={ArrowUp01Icon} size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={isLast} aria-label="Move down" onClick={onMoveDown}>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit rule ${rule.name}`} onClick={onEdit}>
          <HugeiconsIcon icon={PencilEdit02Icon} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete rule ${rule.name}`}
          onClick={() => setConfirmOpen(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </Button>
      </div>
      <Switch
        checked={rule.enabled}
        onCheckedChange={(on) => toggle.mutate(on)}
        aria-label={`Enable rule ${rule.name}`}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete “${rule.name}”?`}
        description="Removes this rule. Transactions it already categorized keep their categories."
        pending={remove.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
