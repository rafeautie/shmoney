import { Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import type { EnvelopeSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { EnvelopeDialog } from '@/components/budget/envelope-dialog'
import { useRemoveEnvelope } from '@/components/budget/use-envelopes'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'

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
      <ActionsMenu label="Envelope Actions">
        <ActionsMenuItem icon={PencilEdit01Icon} onClick={() => setEditing(true)}>
          Edit
        </ActionsMenuItem>
        <ActionsMenuItem
          icon={Delete02Icon}
          destructive
          disabled={remove.isPending}
          onClick={() => remove.mutate(envelope)}
        >
          Delete
        </ActionsMenuItem>
      </ActionsMenu>
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
