import { memo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon } from '@hugeicons/core-free-icons'
import type { ReportFilters, ReportWidget } from '@shared/reports'
import { overriddenFilterKeys } from '@shared/reports'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmButton } from '@/components/confirm-dialog'
import { WidgetRenderer } from './widget-renderer'

const FILTER_LABELS: Record<string, string> = {
  dateRange: 'date range',
  accountIds: 'accounts',
  categoryIds: 'categories',
  includeUncategorized: 'uncategorized',
  categoryGroupIds: 'groups',
  direction: 'direction',
  amountMin: 'min amount',
  amountMax: 'max amount',
  descriptionSearch: 'description',
  includePending: 'pending',
  includeTransfers: 'transfers'
}

function OverrideBadge({ widget }: { widget: ReportWidget }) {
  if (!widget.config) return null
  const { mode } = widget.config.filters
  const keys = overriddenFilterKeys(widget.config.filters)
  if (mode === 'inherit' && keys.length === 0) return null
  const summary =
    mode === 'own'
      ? 'Ignores report filters'
      : `Overrides: ${keys.map((k) => FILTER_LABELS[k] ?? k).join(', ')}`
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="secondary" className="shrink-0 cursor-default" />}>
        {mode === 'own' ? 'Own filters' : `${keys.length} override${keys.length === 1 ? '' : 's'}`}
      </TooltipTrigger>
      <TooltipContent>{summary}</TooltipContent>
    </Tooltip>
  )
}

interface WidgetCardProps {
  widget: ReportWidget
  reportFilters: ReportFilters
  editing: boolean
  /** takes the widget rather than closing over it, so the grid can pass one stable
   * function to every card and keep the memo below effective */
  onEdit: (widget: ReportWidget) => void
  onDelete: (widget: ReportWidget) => void
}

// Memoized because the grid re-renders on every frame of a resize (it follows the
// container width live). None of these props change while that happens, so the card
// and everything under it (tables, budget rows, the chart wrappers and their pivots)
// can sit the resize out. Recharts still redraws each chart from its own
// ResponsiveContainer, which is the only part that actually depends on the size.
export const WidgetCard = memo(function WidgetCard({
  widget,
  reportFilters,
  editing,
  onEdit,
  onDelete
}: WidgetCardProps) {
  // widgets own their edge padding, so the card only pads the header
  return (
    <Card
      className={cn(
        'relative flex h-full flex-col gap-2 pt-3 pb-0 overflow-visible',
        editing && 'border-dashed cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex h-6 shrink-0 items-center gap-2 px-4">
        <h3 className="min-w-0 truncate text-sm font-medium">{widget.title}</h3>
        <OverrideBadge widget={widget} />
        {editing && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onEdit(widget)}>
              Edit
            </Button>
            <ConfirmButton
              variant="ghost"
              size="icon-sm"
              title="Delete this widget?"
              description="This removes the widget from the report."
              onConfirm={(close) => {
                onDelete(widget)
                close()
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              <span className="sr-only">Delete widget</span>
            </ConfirmButton>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <WidgetRenderer widget={widget} reportFilters={reportFilters} />
      </div>
    </Card>
  )
})
