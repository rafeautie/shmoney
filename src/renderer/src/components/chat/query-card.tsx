import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, DatabaseIcon } from '@hugeicons/core-free-icons'
import type { QueryToolResult } from '@shared/chat'
import { cn } from '@/lib/utils'
import { ChatTableCard } from '@/components/chat/chat-table'
import { QueryResult } from '@/components/chat/query-result'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/**
 * One query tool call's lifecycle, live or replayed from a persisted part:
 * writing = the model is still streaming the SQL, running = executing,
 * done = result (or error) available.
 */
export type QueryCardState =
  | { status: 'writing'; sql: string }
  | { status: 'running'; sql: string }
  | { status: 'done'; sql: string; result: QueryToolResult }

/** "8ms" or "1.2s"; queries are usually far quicker than thoughts */
function formatQueryDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`
}

function cardLabel(state: QueryCardState): string {
  if (state.status === 'writing') return 'Writing query…'
  if (state.status === 'running') return 'Running query…'
  const { result } = state
  if (!result.ok) return 'Query failed'
  const rows = `${result.rowCount ?? 0}${result.truncated ? '+' : ''} row${result.rowCount === 1 ? '' : 's'}`
  return `Queried database · ${rows} · ${formatQueryDuration(result.durationMs)}`
}

/**
 * The transcript's window into a `query` tool call: a one-line summary that
 * expands to the SQL and its result. Collapsed by default, live and replayed
 * alike — the shimmering label carries the activity; the user's own toggle
 * always wins.
 */
export function QueryCard({ state }: { state: QueryCardState }) {
  const active = state.status !== 'done'
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? false
  const failed = state.status === 'done' && !state.result.ok
  // the copy/download actions serialize the rendered rows; hide them when
  // there is nothing to serialize (still writing, error, or an empty result)
  const hasRows = state.status === 'done' && state.result.ok && (state.result.rows?.length ?? 0) > 0

  return (
    <Collapsible open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger
        className={cn(
          'group/query flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
          active && 'animate-shimmer',
          failed && 'text-destructive hover:text-destructive'
        )}
      >
        <HugeiconsIcon icon={DatabaseIcon} strokeWidth={2} className="size-3.5" />
        <span>{cardLabel(state)}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="-ml-0.5 size-3.5 group-data-panel-open/query:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ChatTableCard
          className="mt-1.5"
          title={
            <pre className="font-sans whitespace-pre-wrap wrap-break-word text-muted-foreground">
              {state.sql || '…'}
            </pre>
          }
          actions={hasRows}
        >
          {state.status === 'done' && <QueryResult result={state.result} />}
        </ChatTableCard>
      </CollapsibleContent>
    </Collapsible>
  )
}
