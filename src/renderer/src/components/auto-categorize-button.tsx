import type { CategorizeScopeInput } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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

  const button = (
    <Button
      variant="outline"
      className="shrink-0"
      disabled={!llmReady || autoCategorize.anyRunning}
      onClick={() => autoCategorize.start()}
    >
      {autoCategorize.isRunning ? 'Categorizing…' : 'Auto-categorize'}
    </Button>
  )

  // A disabled button emits no pointer events (and a native `title` won't show on
  // one), so when the model isn't downloaded yet, wrap it in a span that does and
  // hang a tooltip off that to explain where to enable it on hover.
  if (!llmReady) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>{button}</TooltipTrigger>
        <TooltipContent>Download a model in Settings to use this</TooltipContent>
      </Tooltip>
    )
  }

  return button
}
