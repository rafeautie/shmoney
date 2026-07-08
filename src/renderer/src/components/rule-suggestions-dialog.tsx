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
import { ScrollArea } from '@/components/ui/scroll-area'

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
      {/* p-0 + flex-col so the ScrollArea fills the dialog edge-to-edge (scrollbar
          rides the dialog edge) and each row carries its own px-4 instead. flex
          (not the default grid) also pins the ScrollArea to the dialog width via
          cross-axis stretch. overflow-hidden clips the list to the rounded corners. */}
      <DialogContent className="flex flex-col p-0 min-w-3xl">
        <DialogHeader className="p-4">
          <DialogTitle>Rule suggestions</DialogTitle>
          <DialogDescription>
            You&apos;ve categorized these identical transactions repeatedly. Create a rule to do it
            automatically from now on.
          </DialogDescription>
        </DialogHeader>
        {suggestions.length === 0 ? (
          <Empty className="px-4 pb-8">
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
          // max-h on the viewport so a long list scrolls rather than pushing the
          // dialog past the window. border-t is the divider above the first row.
          // [&>div]:w-full pins Radix's display:table content wrapper to the
          // viewport width so the rows' truncate works instead of the wrapper
          // growing to the untruncated text and shoving the buttons off-screen.
          <ScrollArea className=" border-t" viewPortClassName="max-h-[60vh]">
            <div className="flex flex-col divide-y ">
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="flex items-center gap-3 px-4 py-3">
                  <div className='w-full'>
                    <div className="truncate text-sm font-medium max-w-100">{suggestion.descriptionKey}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {plural(suggestion.matchCount, 'transaction')} → {suggestion.categoryName}
                    </div>
                  </div>
                  <Button className="shrink-0 leading-none" onClick={() => onCreate(suggestion)}>
                    Create rule
                  </Button>
                  <Button
                    variant="ghost"
                    className="shrink-0 leading-none"
                    disabled={dismissingId === suggestion.id}
                    onClick={() => onDismiss(suggestion.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
