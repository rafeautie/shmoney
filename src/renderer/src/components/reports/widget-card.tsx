import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon } from '@hugeicons/core-free-icons'
import type { ReportFilters, ReportWidget } from '@shared/reports'
import { overriddenFilterKeys } from '@shared/reports'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  descriptionSearch: 'search',
  includePending: 'pending'
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
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="shrink-0 cursor-default">
          {mode === 'own'
            ? 'Own filters'
            : `${keys.length} override${keys.length === 1 ? '' : 's'}`}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{summary}</TooltipContent>
    </Tooltip>
  )
}

interface WidgetCardProps {
  widget: ReportWidget
  reportFilters: ReportFilters
  editing: boolean
  onEdit: () => void
  onDelete: () => void
}

export function WidgetCard({ widget, reportFilters, editing, onEdit, onDelete }: WidgetCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // transactions tables bleed to the card's edges (except the top)
  const flush = widget.type === 'transactions'
  return (
    <Card
      className={cn(
        'relative flex h-full flex-col gap-2 overflow-hidden py-3',
        flush && 'pb-0',
        editing && 'border-dashed cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex h-6 shrink-0 items-center gap-2 px-4">
        <h3 className="min-w-0 truncate text-sm font-medium">{widget.title}</h3>
        <OverrideBadge widget={widget} />
        {editing && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setConfirmingDelete(true)}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              <span className="sr-only">Delete widget</span>
            </Button>
          </div>
        )}
      </div>
      {confirmingDelete && (
        <div
          data-delete-confirm
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/90 backdrop-blur-sm"
        >
          <p className="text-sm font-medium">Delete this widget?</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
      )}
      <div className={cn('min-h-0 flex-1', flush ? '[--table-edge:--spacing(4)]' : 'px-4 pb-1')}>
        <WidgetRenderer widget={widget} reportFilters={reportFilters} />
      </div>
    </Card>
  )
}
