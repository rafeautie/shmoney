import type { EnvelopeSummary } from '@shared/budgets'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import { EditableFill } from '@/components/budget/envelope-fields'
import { spendLine } from '@/components/budget/envelope-labels'
import { BalanceBadge, EnvelopeBar } from '@/components/budget/envelope-progress'
import { useRemoveEnvelope } from '@/components/budget/use-envelopes'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/** One envelope, laid out like a goal card: title, bar, then what you can edit. */
export function EnvelopeCard({
  envelope,
  month,
  currency
}: {
  envelope: EnvelopeSummary
  month: string
  currency: string
}) {
  const remove = useRemoveEnvelope()

  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-base font-semibold tracking-tight">
              {envelope.categoryName}
            </span>
            <BalanceBadge balance={envelope.balance} currency={currency} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" />}
                aria-label="Envelope actions"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
          </div>
        </div>

        <EnvelopeBar spent={envelope.spent} fill={envelope.fill} currency={currency} />

        <p className="text-xs text-muted-foreground">{spendLine(envelope, currency)}</p>

        {/* the settings of the envelope, penned off from the spending it reports */}
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 p-2 text-xs">
          <span className="text-muted-foreground">Monthly fill</span>
          <EditableFill envelope={envelope} month={month} currency={currency} />
        </div>
      </CardContent>
    </Card>
  )
}
