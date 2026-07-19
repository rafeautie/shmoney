import { DatabaseIcon } from '@hugeicons/core-free-icons'
import type { QueryToolResult } from '@shared/chat'
import { ToolCallCard } from '@/components/chat/tool-call'

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
 * The transcript's window into a `query` tool call: the standard tool card
 * with the SQL as input (previewed live while it streams) and the exact
 * result the model received as output.
 */
export function QueryCard({ state }: { state: QueryCardState }) {
  return (
    <ToolCallCard
      icon={DatabaseIcon}
      label={cardLabel(state)}
      active={state.status !== 'done'}
      failed={state.status === 'done' && !state.result.ok}
      input={state.sql || undefined}
      output={state.status === 'done' ? state.result : undefined}
    />
  )
}
