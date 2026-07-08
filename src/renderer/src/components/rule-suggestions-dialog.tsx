import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import type { RuleSuggestion } from '@shared/rule-suggestions'
import { plural } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

// Lists pending rule suggestions. "Create rule" hands the suggestion up to open
// the rule editor pre-filled; "Dismiss" hides it for good. The parent owns the
// data and both actions so it can drive the editor and refresh the list.
export function RuleSuggestionsDialog({
  open,
  onOpenChange,
  suggestions,
  onCreate,
  onDismiss,
  dismissingId
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestions: RuleSuggestion[]
  onCreate: (suggestion: RuleSuggestion) => void
  onDismiss: (id: number) => void
  dismissingId?: number
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rule suggestions</DialogTitle>
          <DialogDescription>
            You&apos;ve categorized these identical transactions repeatedly. Create a rule to do it
            automatically from now on.
          </DialogDescription>
        </DialogHeader>
        {suggestions.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} />
              </EmptyMedia>
              <EmptyTitle>No suggestions</EmptyTitle>
              <EmptyDescription>
                Categorize the same merchant a few times and we&apos;ll suggest a rule here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          // min-w-0 so this grid child can shrink to the dialog width, letting the
          // row's truncate work instead of overflowing the right edge
          <div className="flex min-w-0 flex-col gap-3">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{suggestion.descriptionKey}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {plural(suggestion.matchCount, 'transaction')} → {suggestion.categoryName}
                  </div>
                </div>
                <Button size="sm" className="shrink-0" onClick={() => onCreate(suggestion)}>
                  Create rule
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  disabled={dismissingId === suggestion.id}
                  onClick={() => onDismiss(suggestion.id)}
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
