import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import type { ActionLogEntry, ActionRun } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { runSummary } from '@/lib/activity-feed'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { EntryRow, RowAvatar, UndoneTag } from './entry-row'
import { TriggerIcon } from './source-icon'

/** Everything one sync, import or rules pass wrote, as one card with Undo all. */
export function RunCard({
  run,
  entries,
  categoryName,
  isNew
}: {
  run: ActionRun
  entries: ActionLogEntry[]
  categoryName: Map<number, string>
  isNew: boolean
}) {
  const queryClient = useQueryClient()
  const undoneCount = entries.filter((e) => e.undoneAt !== null).length
  const allUndone = undoneCount === entries.length

  const toggle = useMutation({
    mutationFn: () =>
      allUndone ? window.api.actionLog.redoRun(run.id) : window.api.actionLog.undoRun(run.id),
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Collapsible className="group/run bg-background">
      <div className="flex items-center gap-3 py-2 pr-3 pl-3">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <RowAvatar solid isNew={isNew}>
            <TriggerIcon trigger={run.trigger} size={15} />
          </RowAvatar>
          <div className="min-w-0">
            <div
              className={cn(
                'truncate text-sm font-medium',
                allUndone && 'text-muted-foreground line-through'
              )}
            >
              {run.label}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {format(new Date(run.createdAt), 'p')} · {runSummary(entries)}
              {undoneCount > 0 && !allUndone && (
                <span className="font-medium text-foreground">
                  {' '}
                  · {undoneCount} of {entries.length} undone
                </span>
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-2">
          {allUndone && <UndoneTag>Undone</UndoneTag>}
          <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {allUndone ? 'Redo all' : 'Undo all'}
          </Button>
        </div>
        <CollapsibleTrigger aria-label="Show entries">
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            className="shrink-0 text-muted-foreground transition-transform group-data-open/run:rotate-180"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="divide-y border-t">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} categoryName={categoryName} nested />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
