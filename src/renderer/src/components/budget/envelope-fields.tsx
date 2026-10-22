import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, MoreHorizontalIcon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import type { EnvelopeSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { EnvelopeDialog } from '@/components/budget/envelope-dialog'
import { useRemoveEnvelope } from '@/components/budget/use-envelopes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// The card and the table are two views of the same envelope, so they show it
// through the same fields. None edits in place: every change goes through the
// Edit dialog in the actions menu, so a stray click on a compact layout can't
// start one.

export function EnvelopeFill({
  envelope,
  currency
}: {
  envelope: EnvelopeSummary
  currency: string
}) {
  return (
    <span className="tabular-nums">
      <Amount value={envelope.fill} currency={currency} colored={false} />
    </span>
  )
}

export function EnvelopeActionsMenu({
  envelope,
  month,
  budgetedIds
}: {
  envelope: EnvelopeSummary
  /** viewed month: an edited fill applies from here on */
  month: string
  budgetedIds: number[]
}) {
  const remove = useRemoveEnvelope()
  const [editing, setEditing] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" />}
          aria-label="Envelope actions"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => remove.mutate(envelope)}
            disabled={remove.isPending}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Remove envelope
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EnvelopeDialog
        open={editing}
        onOpenChange={setEditing}
        envelope={envelope}
        month={month}
        budgetedIds={budgetedIds}
      />
    </>
  )
}
