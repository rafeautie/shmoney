import { memo, useState } from 'react'
import { Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import type { ReportFilters, ReportWidget } from '@shared/reports'
import { overriddenFilterKeys } from '@shared/reports'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'
import { ConfirmDialog } from '@/components/confirm-dialog'
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
        {mode === 'own' ? 'Own Filters' : `${keys.length} override${keys.length === 1 ? '' : 's'}`}
      </TooltipTrigger>
      <TooltipContent>{summary}</TooltipContent>
    </Tooltip>
  )
}

interface WidgetCardProps {
  widget: ReportWidget
  reportFilters: ReportFilters
  /** arranging the report: the card is dragged and resized by the grid */
  editing: boolean
  /** marks open their transactions on click; the report grid sets it outside edit mode */
  drillable?: boolean
  /** take the widget rather than closing over it, so the grid can pass one stable
   * function to every card and keep the memo below effective. Leave both out
   * for a preview, which has no actions menu. */
  onEdit?: (widget: ReportWidget) => void
  onDelete?: (widget: ReportWidget) => void
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
  drillable = false,
  onEdit,
  onDelete
}: WidgetCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // widgets own their edge padding, so the card only pads the header
  return (
    <Card
      className={cn(
        'relative flex h-full flex-col gap-1 pt-3 pb-0 overflow-visible',
        editing && 'border-dashed cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex h-6 shrink-0 items-center gap-2 px-4">
        <h3 className="min-w-0 truncate text-sm font-medium">{widget.title}</h3>
        <OverrideBadge widget={widget} />
        {onEdit && onDelete && (
          // the same "…" menu as every other item; it works whether or not the
          // report is being arranged
          <ActionsMenu label="Widget Actions" size="icon-sm" className="-mr-1 ml-auto">
            <ActionsMenuItem icon={PencilEdit01Icon} onClick={() => onEdit(widget)}>
              Edit
            </ActionsMenuItem>
            <ActionsMenuItem icon={Delete02Icon} destructive onClick={() => setConfirmDelete(true)}>
              Delete
            </ActionsMenuItem>
          </ActionsMenu>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <WidgetRenderer widget={widget} reportFilters={reportFilters} drillable={drillable} />
      </div>
      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete “${widget.title}”?`}
          description="This removes the widget from the report."
          onConfirm={(close) => {
            onDelete(widget)
            close()
          }}
        />
      )}
    </Card>
  )
})
