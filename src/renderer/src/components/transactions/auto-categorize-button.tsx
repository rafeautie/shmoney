import type { CategorizeScopeInput } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  categorizeRunLabel,
  useAutoCategorize,
  useCategorizeRun,
  useLlmReady,
  useLlmSupported
} from '@/lib/llm'

/**
 * Header action that auto-categorizes a scope — a whole account when given an
 * `accountId`, or every uncategorized transaction when the scope is empty. Needs a
 * downloaded model (disabled with a hint until then), and is disabled while any
 * categorize run is active, since only one runs at a time. Its own run shows live
 * progress and a Cancel beside it.
 */
export function AutoCategorizeButton({ scope }: { scope: CategorizeScopeInput }) {
  const llmReady = useLlmReady()
  const supported = useLlmSupported()
  const autoCategorize = useAutoCategorize(scope)
  const run = useCategorizeRun()

  if (autoCategorize.isRunning) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" disabled className="tabular-nums">
          {categorizeRunLabel(run)}
        </Button>
        <Button variant="outline" disabled={run.canceling} onClick={run.cancel}>
          Cancel
        </Button>
      </div>
    )
  }

  const button = (
    <Button
      variant="outline"
      className="shrink-0"
      disabled={!llmReady || autoCategorize.anyRunning}
      onClick={() => autoCategorize.start()}
    >
      Auto-categorize
    </Button>
  )

  // A disabled button emits no pointer events (and a native `title` won't show on
  // one), so when the model isn't downloaded yet, wrap it in a span that does and
  // hang a tooltip off that to explain where to enable it on hover.
  if (!llmReady) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>{button}</TooltipTrigger>
        <TooltipContent>
          {supported
            ? 'Download a model in Settings to use this'
            : "Your hardware can't run the local model"}
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
}
