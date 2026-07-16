import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SuggestionGroupRow } from './suggestion-group-row'

// Lists pending rule suggestions grouped per category; each group becomes one
// multi-phrase rule. The rows are self-contained (see SuggestionGroupRow), so
// this dialog only owns its own open state and layout.
export function RuleSuggestionsDialog({
  open,
  onOpenChange,
  groups
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: RuleSuggestionGroup[]
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
            You&apos;ve categorized transactions like these repeatedly. Create one rule per category
            to do it automatically from now on; the highlighted part of each sample is what the rule
            will match.
          </DialogDescription>
        </DialogHeader>
        {groups.length === 0 ? (
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
          <ScrollArea className=" border-t" viewPortClassName="max-h-[60vh]">
            {/* each group is its own bordered settings-style block */}
            <div className="flex flex-col gap-3 p-4">
              {groups.map((group) => (
                <SuggestionGroupRow key={group.categoryId} group={group} />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
