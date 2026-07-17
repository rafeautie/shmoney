import type { QueryToolResult } from '@shared/chat'
import { ChatTableViewport } from '@/components/chat/chat-table'

const cellText = (cell: unknown): string => (cell === null ? 'NULL' : String(cell))

/** A settled query's outcome: the result table, an error line, or "No rows." */
export function QueryResult({ result }: { result: QueryToolResult }) {
  // the card no longer pads its body (tables run full-bleed), so the plain
  // text outcomes carry their own padding
  if (!result.ok) return <p className="px-2 pb-2 text-destructive">{result.error}</p>
  if (!result.columns || !result.rows || result.rows.length === 0)
    return <p className="px-2 pb-2 text-muted-foreground italic">No rows.</p>
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
