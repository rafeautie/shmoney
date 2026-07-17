import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep
} from '@/components/ui/chain-of-thought'

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

/**
 * The turn's chain of thought as its own collapsible, standard reasoning UX:
 * open with a shimmer while the model thinks, collapsing to "Thought for Ns"
 * once the answer (or a tool call) starts. Tool calls are NOT in here — they
 * render inline in the parts flow, in the order they occurred. The user's
 * toggle always wins.
 */
export function ThoughtChain({
  reasoning,
  active
}: {
  reasoning: Reasoning | null
  /** the model is still thinking, so the chain stays expanded */
  active: boolean
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? active

  if (!reasoning) return null

  return (
    <ChainOfThought open={open} onOpenChange={setUserOpen}>
      <ChainOfThoughtHeader className={cn(active && 'animate-shimmer')}>
        {active ? 'Thinking…' : `Thought for ${formatThoughtDuration(reasoning.durationMs ?? 0)}`}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {/* no icon: the header's brain already stands for the thought */}
        <ChainOfThoughtStep>
          <div className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
            {reasoning.text}
          </div>
        </ChainOfThoughtStep>
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}
