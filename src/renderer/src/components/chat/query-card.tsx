import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, DatabaseIcon } from '@hugeicons/core-free-icons'
import type { QueryToolResult } from '@shared/chat'
import { cn } from '@/lib/utils'
import { ChatTableCard, ChatTableViewport } from '@/components/chat/chat-table'
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
 * expands to the SQL and its result. Active cards start open so the SQL is
 * visible while it streams in, then collapse on completion; the user's own
 * toggle always wins.
 */
export function QueryCard({ state }: { state: QueryCardState }) {
  const active = state.status !== 'done'
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? active
  const failed = state.status === 'done' && !state.result.ok
  // the copy/download actions serialize the rendered rows; hide them when
  // there is nothing to serialize (still writing, error, or an empty result)
  const hasRows = state.status === 'done' && state.result.ok && (state.result.rows?.length ?? 0) > 0

  return (
    <Collapsible open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger
        className={cn(
          'group/query flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
          active && 'animate-shimmer',
          failed && 'text-destructive hover:text-destructive'
        )}
      >
        <HugeiconsIcon icon={DatabaseIcon} strokeWidth={2} className="size-3.5" />
        {/* keyed by status so each label change fades in gently */}
        <span key={state.status} className="animate-in fade-in-0 duration-300">
          {cardLabel(state)}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-3.5 transition-transform group-data-panel-open/query:rotate-180"
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

const cellText = (cell: unknown): string => (cell === null ? 'NULL' : String(cell))

function QueryResult({ result }: { result: QueryToolResult }) {
  if (!result.ok) return <p className="text-destructive">{result.error}</p>
  if (!result.columns || !result.rows || result.rows.length === 0)
    return <p className="text-muted-foreground italic">No rows.</p>
  return (
    <ChatTableViewport>
      <table>
        <thead>
          <tr>
            {result.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cellText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && (
        <p className="border-t px-2 py-1 text-muted-foreground italic">Results truncated.</p>
      )}
    </ChatTableViewport>
  )
}
