import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, isToday } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { isSavingsGoalChange, type ActionLogEntry } from '@shared/ipc'
import { cn, plural } from '@/lib/utils'
import { SOURCE_CREDIT } from '@/lib/activity-feed'
import { toastSuperseded } from '@/lib/undo-toast'
import { invalidateAfterUndo } from './invalidate-after-undo'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChangeLine } from './change-line'
import { SourceIcon } from './source-icon'

function noun(entry: ActionLogEntry): string {
  const c = entry.changes[0]
  if (c.field === 'budgetAmount') return 'change'
  if (c.field === 'conversationTitle' || c.field === 'conversationDeletedAt') return 'conversation'
  if (c.field === 'savedFilterDeletedAt') return 'saved filter'
  if (isSavingsGoalChange(c)) return 'savings goal'
  if (c.field === 'categoryDeleted') return c.kind === 'group' ? 'category group' : 'category'
  if (c.field === 'ruleDeleted') return 'rule'
  return 'transaction'
}

function undoneLabel(undoneAt: number): string {
  const at = new Date(undoneAt)
  return `Undone ${format(at, isToday(at) ? 'p' : 'MMM d, p')}`
}

/** The pill that marks an undone entry or run. */
export function UndoneTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-caption font-medium whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  )
}

/** The rounded square that leads every row: what made the change. */
export function RowAvatar({
  children,
  solid,
  small
}: {
  children: ReactNode
  solid?: boolean
  small?: boolean
}) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg',
        small ? 'size-6 rounded-md' : 'size-7',
        solid ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

export function EntryRow({
  entry,
  categoryName,
  nested = false
}: {
  entry: ActionLogEntry
  categoryName: Map<number, string>
  /** inside a run card: indented, and the card already says what made it */
  nested?: boolean
}) {
  const queryClient = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const undone = entry.undoneAt !== null
  // a rule or detector entry sends every row to one category: name it up front
  const target =
    entry.sharedCategoryId !== null ? (categoryName.get(entry.sharedCategoryId) ?? null) : null
  const credit = nested ? undefined : SOURCE_CREDIT[entry.source]
  // a long entry opens on the page's preview lines; the rest load on request
  const allChanges = useQuery({
    queryKey: ['actionLog', 'entryChanges', entry.id],
    queryFn: () => window.api.actionLog.entryChanges(entry.id),
    enabled: showAll
  })
  const lines = (showAll && allChanges.data) || entry.changes
  const hidden = entry.changeCount - lines.length

  const toggle = useMutation({
    mutationFn: () =>
      undone ? window.api.actionLog.redoEntry(entry.id) : window.api.actionLog.undoEntry(entry.id),
    onSuccess: (result) => {
      if (result.applied === 0) toastSuperseded(undone ? 'redo' : 'undo')
    },
    onSettled: () => invalidateAfterUndo(queryClient, [entry])
  })

  return (
    <Collapsible className="group/entry bg-background">
      <div className={cn('group/row flex items-center gap-3 py-2 pr-3', nested ? 'pl-13' : 'pl-3')}>
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <RowAvatar small={nested}>
            <SourceIcon source={entry.source} size={nested ? 13 : 15} />
          </RowAvatar>
          <div className="min-w-0">
            <div
              className={cn(
                'truncate text-sm font-medium',
                undone && 'text-muted-foreground line-through'
              )}
            >
              {entry.label}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {format(new Date(entry.createdAt), 'p')} · {plural(entry.changeCount, noun(entry))}
              {target && (
                <>
                  {' '}
                  · to <span className="font-medium text-foreground">{target}</span>
                </>
              )}
              {credit && ` · ${credit}`}
            </div>
          </div>
        </CollapsibleTrigger>
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 transition-opacity',
            !undone && 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100'
          )}
        >
          {undone && <UndoneTag>{undoneLabel(entry.undoneAt!)}</UndoneTag>}
          <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {undone ? 'Redo' : 'Undo'}
          </Button>
        </div>
        <CollapsibleTrigger aria-label="Show changes">
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            className="shrink-0 text-muted-foreground transition-transform group-data-open/entry:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
      </div>

      {/* padding and border sit inside the panel so it can close to a true 0 */}
      <CollapsibleContent>
        <div className={cn('border-t bg-muted/40 pr-3 pb-1', nested ? 'pl-22' : 'pl-13')}>
          {lines.map((change, i) => (
            <ChangeLine
              key={i}
              change={change}
              categoryName={categoryName}
              className={cn(i > 0 && 'border-t border-dashed')}
            />
          ))}
          {hidden > 0 && (
            <Button
              variant="link"
              size="sm"
              className="-ml-2 text-muted-foreground"
              disabled={allChanges.isFetching}
              onClick={() => setShowAll(true)}
            >
              Show {hidden} more
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
