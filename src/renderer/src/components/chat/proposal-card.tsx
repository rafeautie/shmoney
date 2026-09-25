import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, Tick02Icon, UndoIcon } from '@hugeicons/core-free-icons'
import type { ChatMessage, Proposal, ProposalDisplay } from '@shared/chat'
import { GOAL_STATUS_LABELS, type GoalStatus } from '@shared/goals'
import { plural } from '@/lib/utils'
import { formatBucketLabel, formatMonthLong } from '@/lib/format-date'
import { selectedGroups } from '@/lib/chat-tools'
import { useResolveProposal, useUndoProposal } from '@/lib/chat'
import { Amount } from '@/components/amount'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireTitle
} from '@/components/ui/questionnaire'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { ChatTableViewport } from '@/components/chat/chat-table'
import { TOOL_ICONS } from '@/components/chat/tool-icons'

type Recategorize = Extract<Proposal, { kind: 'recategorize' }>
type SetBudget = Extract<Proposal, { kind: 'set_budget' }>
type UpdateGoal = Extract<Proposal, { kind: 'update_goal' }>

/** where a proposal lives: the settled message and its part index */
export interface ProposalTarget {
  messageId: number
  partIndex: number
}

/** a proposal amount (major units) inline in prose, blurred with the rest under privacy mode */
function Money({ value, currency }: { value: number; currency: string | null }) {
  return (
    <Amount
      value={Math.round(value * 1000)}
      // a mixed-currency scope has no single currency; formatAmount then prints a plain number
      currency={currency ?? ''}
      colored={false}
      className="inline-block"
      blurClassName="scale-85"
    />
  )
}

function statusLabel(status: string): string {
  return GOAL_STATUS_LABELS[status as GoalStatus] ?? status
}

function dateLabel(date: string | null): string {
  return date ? formatBucketLabel(date) : 'no date'
}

/** the goal fields the proposal changes, as title fragments */
function goalChanges(p: UpdateGoal): ReactNode[] {
  const changes: ReactNode[] = []
  if (p.after.targetAmount !== p.before.targetAmount)
    changes.push(
      <span key="amount">
        target to <Money value={p.after.targetAmount} currency={p.currency} />
      </span>
    )
  if (p.after.targetDate !== p.before.targetDate)
    changes.push(<span key="date">target date to {dateLabel(p.after.targetDate)}</span>)
  if (p.after.archived !== p.before.archived)
    changes.push(<span key="archived">{p.after.archived ? 'archive it' : 'unarchive it'}</span>)
  return changes
}

function joinNodes(nodes: ReactNode[]): ReactNode {
  return nodes.map((node, i) => (
    <span key={i}>
      {i > 0 && (i === nodes.length - 1 ? ' and ' : ', ')}
      {node}
    </span>
  ))
}

function PacePoint({ pace, currency }: { pace: UpdateGoal['pace']['before']; currency: string }) {
  return (
    <>
      {pace.neededPerMonth !== null && (
        <>
          <Money value={pace.neededPerMonth} currency={currency} /> a month,{' '}
        </>
      )}
      {statusLabel(pace.status).toLowerCase()}
    </>
  )
}

/** title and effect line of a pending proposal; recategorize reflects the checked merchants */
function pendingText(
  proposal: Proposal,
  selection: { count: number; total: number }
): { title: ReactNode; description: ReactNode } {
  switch (proposal.kind) {
    case 'recategorize': {
      const merchants = proposal.groups.length
      return {
        title: `Move ${plural(selection.count, 'transaction')} to ${proposal.toCategory}`,
        description: (
          <>
            <Money value={Math.abs(selection.total)} currency={proposal.currency} /> in total
            {merchants > 1 ? ` across ${plural(merchants, 'merchant')}` : ''}
            {merchants === 1 ? ` at ${proposal.groups[0].merchant}` : ''}
          </>
        )
      }
    }
    case 'set_budget':
      return {
        title: (
          <>
            Set {proposal.category} budget to{' '}
            <Money value={proposal.after} currency={proposal.currency} /> from{' '}
            {formatMonthLong(proposal.month)}
          </>
        ),
        description: <BudgetEffect proposal={proposal} />
      }
    case 'update_goal':
      return {
        title: (
          <>
            Change {proposal.goal}: {joinNodes(goalChanges(proposal))}
          </>
        ),
        description: (
          <>
            Needs <PacePoint pace={proposal.pace.before} currency={proposal.currency} /> {'→'}{' '}
            <PacePoint pace={proposal.pace.after} currency={proposal.currency} />
            {proposal.pace.after.projectedDate &&
              ` · projected ${dateLabel(proposal.pace.after.projectedDate)}`}
          </>
        )
      }
  }
}

function BudgetEffect({ proposal }: { proposal: SetBudget }) {
  return (
    <>
      {proposal.before === null ? (
        'No budget now'
      ) : (
        <>
          <Money value={proposal.before} currency={proposal.currency} /> {'→'}{' '}
          <Money value={proposal.after} currency={proposal.currency} />
        </>
      )}
      {proposal.averageSpending !== null && (
        <>
          {' · '}spending averages{' '}
          <Money value={proposal.averageSpending} currency={proposal.currency} /> a month
        </>
      )}
    </>
  )
}

/** what an applied proposal did, for the marker (rich) and the toast (plain text) */
function appliedText(display: ProposalDisplay): { node: ReactNode; plain: string } {
  const { proposal } = display
  switch (proposal.kind) {
    case 'recategorize': {
      const count =
        display.applied ?? proposal.groups.reduce((n, g) => n + g.transactionIds.length, 0)
      const text = `Moved ${plural(count, 'transaction')} to ${proposal.toCategory}`
      return { node: text, plain: text }
    }
    case 'set_budget':
      return {
        node: (
          <>
            Set {proposal.category} budget to{' '}
            <Money value={proposal.after} currency={proposal.currency} /> from{' '}
            {formatMonthLong(proposal.month)}
          </>
        ),
        // the toast has no privacy blur, so it leaves the amount out
        plain: `Set the ${proposal.category} budget`
      }
    case 'update_goal':
      return { node: `Updated ${proposal.goal}`, plain: `Updated ${proposal.goal}` }
  }
}

function proposalDisplayAt(message: ChatMessage, partIndex: number): ProposalDisplay | null {
  const part = message.parts[partIndex]
  if (part?.type !== 'functionCall' || !('display' in part) || part.display == null) return null
  return 'proposal' in part.display ? part.display : null
}

/** up to five of the matched rows, so the user sees what would move */
function SampleRows({ proposal }: { proposal: Recategorize }) {
  if (proposal.sample.length === 0) return null
  return (
    <div className="w-full overflow-hidden rounded-md border">
      <ChatTableViewport>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="text-right!">Amount</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {proposal.sample.map((row) => (
              <tr key={row.id}>
                <td>{formatBucketLabel(row.date)}</td>
                <td className="max-w-48 truncate" title={row.description}>
                  {row.description}
                </td>
                <td className="text-right">
                  <Money value={row.amount} currency={proposal.currency} />
                </td>
                <td>{row.category ?? 'Uncategorized'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChatTableViewport>
    </div>
  )
}

function MerchantChoices({
  proposal,
  checked,
  onToggle,
  disabled
}: {
  proposal: Recategorize
  checked: string[]
  onToggle: (merchant: string, on: boolean) => void
  disabled: boolean
}) {
  return (
    // the form is only the choices' container; applying stays on the Apply button
    <Questionnaire onSubmit={(event) => event.preventDefault()}>
      <QuestionnaireItem name="merchants" multiple>
        <QuestionnaireTitle className="mb-0 text-xs">Merchants to move</QuestionnaireTitle>
        {/* a broad match can list dozens of merchants; the card stays compact */}
        <ScrollArea viewPortClassName="max-h-72">
          {/* room for the scrollbar, so it never sits on the choices' borders */}
          <QuestionnaireChoices className="pr-3">
            {proposal.groups.map((group) => (
              <QuestionnaireChoice
                key={group.merchant}
                value={group.merchant}
                checked={checked.includes(group.merchant)}
                onChange={(event) => onToggle(group.merchant, event.target.checked)}
                disabled={disabled}
                className="min-h-0 rounded-lg py-2"
              >
                <span>{group.merchant}</span>
                <QuestionnaireChoiceDescription>
                  {plural(group.transactionIds.length, 'transaction')} ·{' '}
                  <Money value={group.total} currency={proposal.currency} />
                </QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
        </ScrollArea>
      </QuestionnaireItem>
    </Questionnaire>
  )
}

function BusyMarker({ label }: { label: string }) {
  return (
    <Marker role="status" className="w-fit">
      <MarkerIcon>
        <Spinner className="size-3.5" />
      </MarkerIcon>
      <MarkerContent>{label}</MarkerContent>
    </Marker>
  )
}

/**
 * The approval card for one proposed change, rendered outside the collapsed
 * chain like a chart. Its state is only the part's display as the proposal IPC
 * last returned it; the card holds nothing but the merchant checkboxes. target
 * is null while the turn still streams, when there is no settled row to act on.
 */
export function ProposalCard({
  display,
  target
}: {
  display: ProposalDisplay
  target: ProposalTarget | null
}) {
  const { proposal, status } = display
  const resolve = useResolveProposal(proposal.kind)
  const undo = useUndoProposal(proposal.kind)
  const groups = proposal.kind === 'recategorize' ? proposal.groups : []
  const [checked, setChecked] = useState(() => groups.map((g) => g.merchant))

  const runUndo = (at: ProposalTarget) => undo.mutate(at)

  if (undo.isPending) return <BusyMarker label="Undoing…" />

  if (status === 'approved') {
    const { node } = appliedText(display)
    const skipped = display.skipped ?? 0
    return (
      <Marker className="w-fit">
        <MarkerIcon>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </MarkerIcon>
        <MarkerContent>
          {node}
          {skipped > 0 && ` (${skipped} skipped, they changed since the preview)`}
        </MarkerContent>
        {target && display.actionId !== null && (
          <button
            type="button"
            onClick={() => runUndo(target)}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm underline underline-offset-3 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <HugeiconsIcon icon={UndoIcon} strokeWidth={2} className="size-3.5" />
            Undo
          </button>
        )}
      </Marker>
    )
  }

  if (status === 'denied' || status === 'undone') {
    return (
      <Marker className="w-fit opacity-70">
        <MarkerIcon>
          <HugeiconsIcon icon={status === 'denied' ? Cancel01Icon : UndoIcon} strokeWidth={2} />
        </MarkerIcon>
        <MarkerContent>{status === 'denied' ? 'Dismissed' : 'Undone'}</MarkerContent>
      </Marker>
    )
  }

  const selection =
    proposal.kind === 'recategorize'
      ? selectedGroups(proposal.groups, checked)
      : { count: 0, total: 0 }
  const { title, description } = pendingText(proposal, selection)
  const nothingChecked = proposal.kind === 'recategorize' && selection.count === 0

  const decide = (decision: 'approve' | 'deny') => {
    if (!target) return
    const merchants =
      proposal.kind === 'recategorize' && checked.length < groups.length ? checked : undefined
    resolve.mutate(
      { ...target, decision, merchants },
      {
        onSuccess: (message) => {
          if (decision !== 'approve') return
          const next = proposalDisplayAt(message, target.partIndex)
          if (next?.status !== 'approved') return
          toast(appliedText(next).plain, {
            action:
              next.actionId === null ? undefined : { label: 'Undo', onClick: () => runUndo(target) }
          })
        }
      }
    )
  }

  const busyLabel = resolve.variables?.decision === 'deny' ? 'Dismissing…' : 'Applying…'

  return (
    <Item variant="outline" className="items-start">
      <ItemMedia variant="icon">
        <HugeiconsIcon icon={TOOL_ICONS[proposal.kind]} strokeWidth={2} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-2 block w-full">{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {resolve.isPending ? (
          <BusyMarker label={busyLabel} />
        ) : (
          <>
            <Button variant="ghost" disabled={!target} onClick={() => decide('deny')}>
              Dismiss
            </Button>
            <Button disabled={!target || nothingChecked} onClick={() => decide('approve')}>
              Apply
            </Button>
          </>
        )}
      </ItemActions>
      {proposal.kind === 'recategorize' && (
        <ItemFooter className="flex-col items-stretch gap-2.5 pt-1">
          <SampleRows proposal={proposal} />
          {proposal.groups.length > 1 && (
            <MerchantChoices
              proposal={proposal}
              checked={checked}
              disabled={resolve.isPending || !target}
              onToggle={(merchant, on) =>
                setChecked((prev) =>
                  on ? [...prev, merchant] : prev.filter((m) => m !== merchant)
                )
              }
            />
          )}
        </ItemFooter>
      )}
    </Item>
  )
}
