import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { isSavingsGoalChange, type ActionLogChange } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { formatBucketLabel } from '@/lib/format-date'
import { Amount } from '@/components/amount'

type Diff = { from: ReactNode; to: ReactNode } | { tag: string }

interface Line {
  date?: string
  subject: ReactNode
  /** muted text after the subject: an account, or which field changed */
  meta?: string | null
  amount?: ReactNode
  diff: Diff
}

const missing = (text: string) => <span className="text-muted-foreground italic">{text}</span>

const plainAmount = (value: number, currency: string) => (
  <Amount value={value} currency={currency} colored={false} />
)

const isoDate = (value: string | null) =>
  value === null ? 'None' : format(new Date(`${value}T12:00:00`), 'MMM d, yyyy')

const shown = (on: number | null, set: string, cleared: string): Diff => ({
  tag: on === null ? cleared : set
})

function describe(change: ActionLogChange, categoryName: Map<number, string>): Line {
  if (change.field === 'budgetAmount') {
    return {
      date: formatBucketLabel(change.month),
      subject:
        change.categoryName !== null
          ? `${change.categoryName} envelope`
          : missing('Category no longer exists'),
      diff: {
        from: change.before === null ? 'None' : plainAmount(change.before, change.currency),
        to: change.after === null ? 'None' : plainAmount(change.after, change.currency)
      }
    }
  }
  if (change.field === 'conversationTitle') {
    return {
      subject: 'Conversation title',
      diff: { from: change.before ?? 'Untitled', to: change.after }
    }
  }
  if (change.field === 'conversationDeletedAt') {
    return {
      subject: change.title ?? 'Untitled conversation',
      diff: shown(change.after, 'Deleted', 'Restored')
    }
  }
  if (change.field === 'savedFilterDeletedAt') {
    return { subject: change.name, diff: shown(change.after, 'Deleted', 'Restored') }
  }
  if (isSavingsGoalChange(change)) {
    switch (change.field) {
      case 'savingsGoalDeletedAt':
        return { subject: change.name, diff: shown(change.after, 'Deleted', 'Restored') }
      case 'savingsGoalArchivedAt':
        return { subject: change.name, diff: shown(change.after, 'Archived', 'Unarchived') }
      case 'savingsGoalTargetDate':
        return {
          subject: change.name,
          meta: 'Target date',
          diff: { from: isoDate(change.before), to: isoDate(change.after) }
        }
      case 'savingsGoalTargetAmount':
        return {
          subject: change.name,
          meta: 'Target',
          diff: {
            from: plainAmount(change.before, change.currency),
            to: plainAmount(change.after, change.currency)
          }
        }
    }
  }

  // a transaction change, joined to the row as it is now
  const gone = change.description === null
  const base = {
    date: change.date ? format(new Date(change.date * 1000), 'MMM d') : undefined,
    subject: gone ? missing('Transaction no longer exists') : change.description,
    meta: change.accountName,
    amount:
      change.amount !== null && change.currency ? (
        <Amount value={change.amount} currency={change.currency} />
      ) : undefined
  }
  const category = (id: number | null) =>
    id === null ? 'Uncategorized' : (categoryName.get(id) ?? 'Unknown category')

  switch (change.field) {
    case 'categoryId':
      return { ...base, diff: { from: category(change.before), to: category(change.after) } }
    case 'deletedAt':
      // imports and creates log as deletedAt now -> null, so undo removes the row
      return { ...base, diff: { tag: change.after === null ? 'Added' : 'Deleted' } }
    case 'description':
      return { ...base, meta: 'Description', diff: { from: change.before, to: change.after } }
    case 'amount':
      return {
        ...base,
        meta: 'Amount',
        amount: undefined,
        diff:
          change.currency && change.before !== null && change.after !== null
            ? {
                from: plainAmount(change.before, change.currency),
                to: plainAmount(change.after, change.currency)
              }
            : { tag: 'Amount changed' }
      }
    case 'posted':
      return {
        ...base,
        meta: 'Date',
        diff: {
          from:
            change.before === null ? 'None' : format(new Date(change.before * 1000), 'MMM d, yyyy'),
          to: change.after === null ? 'None' : format(new Date(change.after * 1000), 'MMM d, yyyy')
        }
      }
  }
}

/** One change as date · subject · amount · before → after, the same columns for every kind. */
export function ChangeLine({
  change,
  categoryName,
  className
}: {
  change: ActionLogChange
  categoryName: Map<number, string>
  className?: string
}) {
  const line = describe(change, categoryName)
  return (
    <div
      className={cn(
        'grid grid-cols-[3.5rem_minmax(0,1fr)_6rem_minmax(14rem,auto)] items-center gap-3 py-1.5 text-xs',
        className
      )}
    >
      <span className="text-muted-foreground tabular-nums">{line.date}</span>
      <span className="min-w-0 truncate">
        {line.subject}
        {line.meta && <span className="ml-1.5 text-muted-foreground">{line.meta}</span>}
      </span>
      <span className="text-right">{line.amount}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {'tag' in line.diff ? (
          <span className="rounded-sm bg-background px-1.5 py-px text-muted-foreground ring-1 ring-border">
            {line.diff.tag}
          </span>
        ) : (
          <>
            <span className="truncate text-muted-foreground line-through decoration-muted-foreground/60">
              {line.diff.from}
            </span>
            <span aria-label="to" className="text-muted-foreground">
              →
            </span>
            <span className="truncate rounded-sm bg-background px-1.5 py-px font-medium ring-1 ring-border">
              {line.diff.to}
            </span>
          </>
        )}
      </span>
    </div>
  )
}
