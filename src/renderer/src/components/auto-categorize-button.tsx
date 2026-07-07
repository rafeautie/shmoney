import type { CategorizeScopeInput } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { useAutoCategorize, useLlmReady } from '@/lib/llm'

/**
 * Header action that auto-categorizes a scope — a whole account when given an
 * `accountId`, or every uncategorized transaction when the scope is empty. Needs a
 * downloaded model (disabled with a hint until then), and is disabled while any
 * categorize run is active, since only one runs at a time. Progress and cancel for
 * a run in flight live in the navbar notification center.
 */
export function AutoCategorizeButton({ scope }: { scope: CategorizeScopeInput }) {
  const llmReady = useLlmReady()
  const autoCategorize = useAutoCategorize(scope)

  return (
    <Button
      variant="outline"
      className="shrink-0"
      disabled={!llmReady || autoCategorize.anyRunning}
      title={llmReady ? 'Auto-categorize' : 'Download a model in Settings to use this'}
      onClick={() => autoCategorize.start()}
    >
      {autoCategorize.isRunning ? 'Categorizing…' : 'Auto-categorize'}
    </Button>
  )
}
