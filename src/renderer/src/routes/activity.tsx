import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import type { ActionLogEntry } from '@shared/ipc'
import { groupSuggestions, type RuleSuggestion } from '@shared/rule-suggestions'
import { cn, plural } from '@/lib/utils'
import { Page } from '@/components/page'
import { EntrySourceIcon } from '@/components/entry-source-icon'
import { SuggestionGroupRow } from '@/components/suggestion-group-row'
import { Amount } from '@/components/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

export const Route = createFileRoute('/activity')({
  component: ActivityPage
})

function dayLabel(ms: number): string {
  const date = new Date(ms)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, MMM d, yyyy')
}

function ActivityPage() {
  const query = useQuery({ queryKey: ['actionLog'], queryFn: () => window.api.actionLog.list() })
  const entries = query.data ?? []

  const suggestionsQuery = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: () => window.api.ruleSuggestions.list()
  })
  const suggestions = suggestionsQuery.data ?? []

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
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

  // entries arrive newest-first; collapse runs of the same calendar day
  const groups: { label: string; entries: ActionLogEntry[] }[] = []
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt)
    const last = groups.at(-1)
    if (last && last.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }

  return (
    <Page className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Activity</h2>
        <p className="text-muted-foreground">
          Rule suggestions to review, then a permanent history of every change to your transactions
          and budgets, manual or automatic. Undo or redo any change.
        </p>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* dismissible items live here, apart from the history: dismissing or
              accepting a suggestion must never erase anything below */}
          {suggestions.length > 0 && <SuggestionsSection suggestions={suggestions} />}

          {entries.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Clock01Icon} />
                </EmptyMedia>
                <EmptyTitle>No activity yet</EmptyTitle>
                <EmptyDescription>
                  Categorizing, deleting, or marking transfers shows up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="space-y-2">
                <h3 className="text-base font-semibold tracking-tight">{group.label}</h3>
                <div className="divide-y overflow-hidden rounded-lg border">
                  {group.entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} categoryName={categoryName} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </Page>
  )
}

// The Suggestions section: when the list runs long it's capped, with a bottom
// fade and a Show more button that expands it in place.
function SuggestionsSection({ suggestions }: { suggestions: RuleSuggestion[] }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold tracking-tight">Suggestions</h3>
      <div className="relative">
        {/* the inline ref re-measures every commit (data changes, expand);
            setState bails out when the value is unchanged */}
        <div
          ref={(el) => {
            if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1)
          }}
          className={cn('space-y-2', !expanded && 'max-h-64 overflow-hidden')}
        >
          {/* each group is its own bordered settings-style block */}
          {groupSuggestions(suggestions).map((group) => (
            <SuggestionGroupRow key={group.categoryId} group={group} />
          ))}
        </div>
        {!expanded && overflowing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-linear-to-t from-background to-transparent">
            <Button
              variant="ghost"
              size="sm"
              className="pointer-events-auto"
              onClick={() => setExpanded(true)}
            >
              Show more suggestions
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function EntryRow({
  entry,
  categoryName
}: {
  entry: ActionLogEntry
  categoryName: Map<number, string>
}) {
  const queryClient = useQueryClient()
  const undone = entry.undoneAt !== null
  // both the transfer detector and rules are automated (non-user) changes
  const isAutomated = entry.source !== 'user'
  // category-set entries (manual, rule, or auto) show which category each row got
  const isCategoryEntry = entry.changes.some((c) => c.field === 'categoryId')
  // envelope fill entries: one change per (category, month), no transaction context
  const isBudgetEntry = entry.changes.some((c) => c.field === 'budgetAmount')

  const toggle = useMutation({
    mutationFn: () =>
      undone ? window.api.actionLog.redoEntry(entry.id) : window.api.actionLog.undoEntry(entry.id),
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Collapsible className={cn('group/entry bg-background px-3 py-2.5', undone && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <EntrySourceIcon
          source={entry.source}
          size={18}
          className="shrink-0 text-muted-foreground"
        />
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <div className="min-w-0">
            <div className={cn('truncate text-sm font-medium', undone && 'line-through')}>
              {entry.label}
            </div>
            <div className="text-xs text-muted-foreground">
              {format(new Date(entry.createdAt), 'p')} ·{' '}
              {plural(entry.changes.length, isBudgetEntry ? 'change' : 'transaction')}
            </div>
          </div>
        </CollapsibleTrigger>
        {isAutomated && (
          <Badge variant="secondary">
            {entry.source === 'rule' ? 'Rule' : entry.source === 'import' ? 'Import' : 'Auto'}
          </Badge>
        )}
        {undone && <Badge variant="outline">Undone</Badge>}
        <Button
          variant="ghost"
          size="sm"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {undone ? 'Redo' : 'Undo'}
        </Button>
        <CollapsibleTrigger>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            className="ml-auto shrink-0 text-muted-foreground transition-transform group-data-open/entry:rotate-180"
          />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="-mx-3 -mb-2.5 mt-2 border-t">
        <Table className="[&_td:first-child]:pl-3 [&_th:first-child]:pl-3 [&_td:last-child]:pr-3 [&_th:last-child]:pr-3 [&_td]:h-auto [&_td]:py-1 [&_th]:h-auto [&_th]:py-1">
          <TableHeader>
            <TableRow>
              <TableHead className="font-normal text-muted-foreground">Date</TableHead>
              <TableHead className="font-normal text-muted-foreground">Account</TableHead>
              <TableHead className="w-full font-normal text-muted-foreground">
                Description
              </TableHead>
              <TableHead className="text-right font-normal text-muted-foreground">Amount</TableHead>
              {isCategoryEntry && (
                <TableHead className="font-normal text-muted-foreground">Category</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.changes.map((change) =>
              change.field === 'budgetAmount' ? (
                <TableRow
                  key={`${change.categoryId}:${change.month}`}
                  className="hover:bg-transparent"
                >
                  <TableCell className="text-muted-foreground">{change.month}</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="w-full max-w-0 truncate">
                    {change.categoryName !== null ? (
                      `${change.categoryName} envelope`
                    ) : (
                      <span className="text-muted-foreground italic">
                        Category no longer exists
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {change.after !== null ? (
                      <Amount value={change.after} currency={change.currency} colored={false} />
                    ) : (
                      <span className="text-muted-foreground">Removed</span>
                    )}
                  </TableCell>
                  {isCategoryEntry && <TableCell />}
                </TableRow>
              ) : (
                <TableRow key={change.transactionId} className="hover:bg-transparent">
                  {change.description === null ? (
                    <TableCell
                      colSpan={isCategoryEntry ? 5 : 4}
                      className="text-muted-foreground italic"
                    >
                      Transaction no longer exists
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-muted-foreground">
                        {change.date ? new Date(change.date * 1000).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{change.accountName}</TableCell>
                      <TableCell className="w-full max-w-0 truncate">
                        {change.description}
                      </TableCell>
                      <TableCell className="text-right">
                        {change.amount !== null && change.currency && (
                          <Amount value={change.amount} currency={change.currency} />
                        )}
                      </TableCell>
                      {isCategoryEntry && (
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {typeof change.after === 'number'
                            ? (categoryName.get(change.after) ?? 'Unknown category')
                            : 'Uncategorized'}
                        </TableCell>
                      )}
                    </>
                  )}
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  )
}
