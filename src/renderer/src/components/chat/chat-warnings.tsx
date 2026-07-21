import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAutoCategorize, useLlmReady } from '@/lib/llm'
import { ChatWarning, type ChatWarningItem } from '@/components/chat/chat-warning'

// warn once uncategorized transactions reach this share of the visible set
const UNCATEGORIZED_THRESHOLD = 0.25

/**
 * Collects the warnings that currently apply to the chat. Each rule is evaluated
 * unconditionally (hooks stay top-level) and returns an item or nothing; add a
 * rule by pushing another item. Today the only rule is "too many uncategorized".
 */
function useChatWarningItems(): ChatWarningItem[] {
  const items: ChatWarningItem[] = []

  const stats = useQuery({
    queryKey: ['transactions', 'stats'],
    queryFn: () => window.api.transactions.stats()
  }).data
  const llmReady = useLlmReady()
  const categorize = useAutoCategorize({})

  if (stats && stats.total > 0) {
    const ratio = stats.uncategorized / stats.total
    if (ratio >= UNCATEGORIZED_THRESHOLD) {
      items.push({
        key: 'uncategorized',
        message: `${Math.round(ratio * 100)}% of your transactions aren't categorized yet.`,
        subtitle: 'Categorized transactions help the assistant answer more accurately.',
        action: {
          label: categorize.isRunning ? 'Categorizing…' : 'Auto-categorize',
          onClick: () => categorize.start(),
          disabled: !llmReady || categorize.anyRunning
        }
      })
    }
  }

  return items
}

/**
 * The warning stack pinned to the top of the chat composer. Owns dismissal
 * (session-scoped, keyed per warning) and renders whatever rules currently apply.
 */
export function ChatWarnings() {
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const items = useChatWarningItems().filter((w) => !dismissed[w.key])
  if (items.length === 0) return null

  return (
    <div className="space-y-1.5 overflow-hidden">
      {items.map((w) => (
        <ChatWarning
          key={w.key}
          subtitle={w.subtitle}
          action={w.action}
          onDismiss={() => setDismissed((d) => ({ ...d, [w.key]: true }))}
        >
          {w.message}
        </ChatWarning>
      ))}
    </div>
  )
}
