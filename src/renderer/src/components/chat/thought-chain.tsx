import { useState } from 'react'
import { DatabaseIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep
} from '@/components/ui/chain-of-thought'
import { QueryCard, type QueryCardState } from '@/components/chat/query-card'

export interface Reasoning {
  text: string
  /** null while streaming, before the thinking phase has ended */
  durationMs: number | null
}

/** "12s" or "1m 5s"; sub-second thoughts round up so the label never says 0s */
function formatThoughtDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** "Thought for 12s · 2 queries" — what the settled chain collapses to */
function chainLabel(reasoning: Reasoning | null, callCount: number): string {
  const parts: string[] = []
  if (reasoning) parts.push(`Thought for ${formatThoughtDuration(reasoning.durationMs ?? 0)}`)
  if (callCount > 0) parts.push(`${callCount} ${callCount === 1 ? 'query' : 'queries'}`)
  return parts.join(' · ')
}

/**
 * The turn's reasoning and query calls as one chain of thought: a timeline of
 * steps that stays open while the model works, then collapses to a summary
 * once the answer starts, so settled turns read as just the answer. The thought
 * itself sits open on the rail; only the query steps, which carry SQL and a
 * result table, are worth a toggle. The user's toggle always wins.
 */
export function ThoughtChain({
  reasoning,
  calls,
  active
}: {
  reasoning: Reasoning | null
  calls: QueryCardState[]
  /** the turn is still working, so the chain stays expanded */
  active: boolean
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? active

  if (!reasoning && calls.length === 0) return null

  return (
    <ChainOfThought open={open} onOpenChange={setUserOpen}>
      <ChainOfThoughtHeader className={cn(active && 'animate-shimmer')}>
        {active ? 'Working…' : chainLabel(reasoning, calls.length)}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {reasoning && (
          // no icon: the header's brain already stands for the thought, and no
          // toggle either — the header summarises it, so a second one would
          // just be in the way
          <ChainOfThoughtStep>
            <div className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
              {reasoning.text}
            </div>
          </ChainOfThoughtStep>
        )}
        {calls.map((call, i) => (
          <ChainOfThoughtStep
            key={i}
            icon={DatabaseIcon}
            status={call.status === 'done' ? 'complete' : 'active'}
          >
            <QueryCard state={call} />
          </ChainOfThoughtStep>
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}
