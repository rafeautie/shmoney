import { DatabaseIcon } from '@hugeicons/core-free-icons'
import type { QueryToolResult } from '@shared/chat'
import { ToolCallCard } from '@/components/chat/tool-call'

/** "8ms" or "1.2s"; queries are usually far quicker than thoughts */
function formatQueryDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`
}

function cardLabel(result: QueryToolResult | undefined): string {
  if (!result) return 'Writing query…'
  if (!result.ok) return 'Query failed'
  const rows = `${result.rowCount ?? 0}${result.truncated ? '+' : ''} row${result.rowCount === 1 ? '' : 's'}`
  return `Queried database · ${rows} · ${formatQueryDuration(result.durationMs)}`
}

/**
 * The transcript's window into a `query` tool call, straight off its part:
 * pending (no result yet — the model is still writing the params) shimmers,
 * settled shows the SQL as input and the exact result the model received as
 * output.
 */
export function QueryCard({ sql, result }: { sql?: string; result?: QueryToolResult }) {
  return (
    <ToolCallCard
      icon={DatabaseIcon}
      label={cardLabel(result)}
      active={!result}
      failed={result ? !result.ok : false}
      input={sql}
      output={result}
    />
  )
}
