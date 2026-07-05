import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon
} from '@hugeicons/core-free-icons'
import { format } from 'date-fns'
import type { Rule, RuleConditions } from '@shared/rules'
import { useApplyRulesOnSync } from '@/lib/settings'
import { ipcErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { RuleEditor } from './rules-editor'
import { RulesPreviewDialog } from './rules-preview-dialog'

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
  if (d) parts.push(`description ${d.op === 'equals' ? 'is' : d.op} "${d.value}"`)
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

  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: () => window.api.rules.list() })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => window.api.categories.list() })
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => window.api.accounts.list() })

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

  const rules = rulesQuery.data ?? []

  const reorder = useMutation({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rules</CardTitle>
        <CardDescription>
          Automatically categorize or flag transactions as they sync. Rules run top to bottom and
          only fill blanks — they never overwrite something you set by hand.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={rules.length === 0}>
            Apply rules now
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch id="apply-rules-on-sync" checked={applyRulesOnSync} onCheckedChange={setApplyRulesOnSync} />
          <Label htmlFor="apply-rules-on-sync">Apply rules automatically on sync</Label>
        </div>

        {rulesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
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
            ))}
          </ul>
        )}

        <Button
          variant="outline"
          onClick={() => {
            setEditingRule(null)
            setEditorOpen(true)
          }}
        >
          <HugeiconsIcon icon={PlusSignIcon} size={14} />
          Add rule
        </Button>

        {reorder.isError && (
          <p className="text-sm text-destructive">{ipcErrorMessage(reorder.error)}</p>
        )}
      </CardContent>

      <RuleEditor rule={editingRule} open={editorOpen} onOpenChange={setEditorOpen} />
      <RulesPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
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

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => window.api.rules.update({ id: rule.id, enabled }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })
  const remove = useMutation({
    mutationFn: () => window.api.rules.delete(rule.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  return (
    <li className="flex items-center gap-3 rounded-lg border p-3">
      <Switch
        checked={rule.enabled}
        onCheckedChange={(on) => toggle.mutate(on)}
        aria-label={`Enable rule ${rule.name}`}
      />
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
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </Button>
      </div>
    </li>
  )
}
