import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  Clock01Icon
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import type { ActionLogEntry } from '@shared/ipc'
import { cn, plural } from '@/lib/utils'
import { Page } from '@/components/page'
import { Amount } from '@/components/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
          Every change to your transactions, manual or automatic. Undo or redo any of them.
        </p>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No activity yet. Categorizing, deleting, or marking transfers shows up here.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label} className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </h3>
              <div className="divide-y rounded-lg border">
                {group.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} categoryName={categoryName} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
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
  const isDetector = entry.source === 'detector'
  // both the transfer detector and rules are automated (non-user) changes
  const isAutomated = entry.source !== 'user'
  // category-set entries (manual, rule, or auto) show which category each row got
  const isCategoryEntry = entry.changes.some((c) => c.field === 'categoryId')

  const toggle = useMutation({
    mutationFn: () =>
      undone ? window.api.actionLog.redoEntry(entry.id) : window.api.actionLog.undoEntry(entry.id),
    onSuccess: (result) => {
      // compare-and-set: 0 rows changed means a later edit already overrode this
      if (result.applied === 0) {
        toast(`Nothing to ${undone ? 'redo' : 'undo'} — a later change supersedes this one`)
      }
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Collapsible className={cn('group/entry px-3 py-2.5', undone && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <HugeiconsIcon
          icon={isDetector ? ArrowDataTransferHorizontalIcon : Clock01Icon}
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
              {plural(entry.changes.length, 'transaction')}
            </div>
          </div>
        </CollapsibleTrigger>
        {isAutomated && (
          <Badge variant="secondary">{entry.source === 'rule' ? 'Rule' : 'Auto'}</Badge>
        )}
        {undone && <Badge variant="outline">Undone</Badge>}
        <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
          {undone ? 'Redo' : 'Undo'}
        </Button>
        <CollapsibleTrigger>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            className="ml-auto shrink-0 text-muted-foreground transition-transform group-data-[state=open]/entry:rotate-180"
          />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="-mx-3 -mb-2.5 mt-2 border-t">
        <Table className="[&_td:first-child]:pl-3 [&_th:first-child]:pl-3 [&_td:last-child]:pr-3 [&_th:last-child]:pr-3 [&_td]:h-auto [&_td]:py-1 [&_th]:h-auto [&_th]:py-1">
          <TableHeader>
            <TableRow>
              <TableHead className="font-normal text-muted-foreground">Date</TableHead>
              <TableHead className="font-normal text-muted-foreground">Account</TableHead>
              <TableHead className="w-full font-normal text-muted-foreground">Description</TableHead>
              <TableHead className="text-right font-normal text-muted-foreground">Amount</TableHead>
              {isCategoryEntry && (
                <TableHead className="font-normal text-muted-foreground">Category</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.changes.map((change) => (
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
                    <TableCell className="w-full max-w-0 truncate">{change.description}</TableCell>
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
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  )
}
