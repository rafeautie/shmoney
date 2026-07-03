import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_REPORT_FILTERS,
  DEFAULT_WIDGET_CONFIG,
  type ReportFilters,
  type ReportWidget,
  type WidgetConfig,
  type WidgetType
} from '@shared/reports'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  AccountsControl,
  AmountRangeControl,
  CategoriesControl,
  DateRangeControl,
  DirectionControl
} from './filter-controls'
import { WidgetRenderer } from './widget-renderer'

const TYPE_LABELS: Record<WidgetType, string> = {
  bar: 'Bar chart',
  line: 'Line chart',
  area: 'Area chart',
  pie: 'Pie chart',
  stat: 'Stat card',
  summaryTable: 'Summary table',
  transactions: 'Transactions table'
}

const MEASURE_LABELS = {
  expense: 'Expenses',
  income: 'Income',
  sum: 'Net (income − expenses)',
  count: 'Transaction count',
  avg: 'Average amount'
} as const

const GROUP_LABELS = {
  none: 'None',
  category: 'Category',
  categoryGroup: 'Category group',
  account: 'Account'
} as const

const GRAIN_LABELS = {
  none: 'No time axis',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly'
} as const

interface Draft {
  title: string
  type: WidgetType
  config: WidgetConfig
}

function draftFor(widget: ReportWidget | null): Draft {
  if (widget) {
    return {
      title: widget.title,
      type: widget.type,
      config: widget.config ?? DEFAULT_WIDGET_CONFIG
    }
  }
  return { title: 'New widget', type: 'bar', config: DEFAULT_WIDGET_CONFIG }
}

/** Types with a fixed (absent) time axis */
const NO_TIME_TYPES: WidgetType[] = ['pie', 'stat', 'summaryTable']

function normalizeForType(config: WidgetConfig, type: WidgetType): WidgetConfig {
  const query = { ...config.query }
  if (NO_TIME_TYPES.includes(type)) query.timeGrain = 'none'
  if ((type === 'line' || type === 'area') && query.timeGrain === 'none') query.timeGrain = 'month'
  if ((type === 'pie' || type === 'summaryTable') && query.groupBy === 'none') {
    query.groupBy = 'category'
  }
  return { ...config, query }
}

interface WidgetEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportId: number
  reportFilters: ReportFilters
  /** null = creating a new widget */
  widget: ReportWidget | null
  /** where a newly created widget lands */
  nextPosition: { x: number; y: number; w: number; h: number }
}

export function WidgetEditor({
  open,
  onOpenChange,
  reportId,
  reportFilters,
  widget,
  nextPosition
}: WidgetEditorProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftFor(widget))

  // reset the draft whenever the editor opens for a different target
  // (render-time state adjustment; avoids an effect + extra commit)
  const editKey = open ? `${widget?.id ?? 'new'}` : null
  const [lastEditKey, setLastEditKey] = useState<string | null>(editKey)
  if (editKey !== lastEditKey) {
    setLastEditKey(editKey)
    if (editKey !== null) setDraft(draftFor(widget))
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const config = normalizeForType(draft.config, draft.type)
      if (widget) {
        return window.api.reports.widgetUpdate({
          id: widget.id,
          title: draft.title.trim() || 'Untitled widget',
          type: draft.type,
          config
        })
      }
      return window.api.reports.widgetCreate({
        reportId,
        title: draft.title.trim() || 'Untitled widget',
        type: draft.type,
        config,
        ...nextPosition
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report', reportId] })
      onOpenChange(false)
    }
  })

  const config = normalizeForType(draft.config, draft.type)
  const query = config.query
  const filters = config.filters
  const isTransactions = draft.type === 'transactions'
  const isChart = draft.type === 'line' || draft.type === 'bar' || draft.type === 'area'
  const hasTimeAxis = !NO_TIME_TYPES.includes(draft.type) && query.timeGrain !== 'none'

  function patchQuery(patch: Partial<WidgetConfig['query']>) {
    setDraft((d) => ({ ...d, config: { ...d.config, query: { ...d.config.query, ...patch } } }))
  }
  function patchDisplay(patch: Partial<NonNullable<WidgetConfig['display']>>) {
    setDraft((d) => ({
      ...d,
      config: { ...d.config, display: { ...d.config.display, ...patch } }
    }))
  }
  function patchOverrides(patch: Partial<WidgetConfig['filters']['overrides']>) {
    setDraft((d) => {
      const overrides = { ...d.config.filters.overrides }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (overrides as Record<string, unknown>)[key]
        else (overrides as Record<string, unknown>)[key] = value
      }
      return { ...d, config: { ...d.config, filters: { ...d.config.filters, overrides } } }
    })
  }

  const base = filters.mode === 'own' ? DEFAULT_REPORT_FILTERS : reportFilters
  const overrides = filters.overrides

  // preview widget: negative id keeps its query cache separate from the real widget
  const previewWidget: ReportWidget = {
    id: widget?.id ?? -1,
    reportId,
    title: draft.title,
    type: draft.type,
    config,
    x: 0,
    y: 0,
    w: 6,
    h: 4
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{widget ? 'Edit widget' : 'Add widget'}</SheetTitle>
          <SheetDescription>
            Choose what to measure and how to display it. Filters can inherit from the report or
            override it.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 px-4 pb-4">
          {/* preview */}
          <div className="h-56 rounded-lg border p-3">
            <WidgetRenderer widget={previewWidget} reportFilters={reportFilters} />
          </div>

          {/* basics */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="widget-title">Title</Label>
              <Input
                id="widget-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Widget type</Label>
              <Select
                value={draft.type}
                onValueChange={(type) => setDraft((d) => ({ ...d, type: type as WidgetType }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as WidgetType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* data */}
          {!isTransactions && (
            <div className="space-y-4">
              <h4 className="text-sm font-semibold">Data</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Measure</Label>
                  <Select
                    value={query.measure}
                    onValueChange={(v) => patchQuery({ measure: v as typeof query.measure })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MEASURE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Group by</Label>
                  <Select
                    value={query.groupBy}
                    onValueChange={(v) => patchQuery({ groupBy: v as typeof query.groupBy })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(GROUP_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!NO_TIME_TYPES.includes(draft.type) && (
                  <div className="space-y-2">
                    <Label>Time grain</Label>
                    <Select
                      value={query.timeGrain}
                      onValueChange={(v) => patchQuery({ timeGrain: v as typeof query.timeGrain })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(GRAIN_LABELS)
                          .filter(
                            ([value]) =>
                              value !== 'none' || (draft.type !== 'line' && draft.type !== 'area')
                          )
                          .map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(draft.type === 'pie' || draft.type === 'summaryTable') && (
                  <div className="space-y-2">
                    <Label>Top N groups</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      placeholder={draft.type === 'pie' ? '8' : 'All'}
                      key={`limit-${query.limit ?? 'none'}`}
                      defaultValue={query.limit ?? ''}
                      onBlur={(e) => {
                        const parsed = Number(e.target.value)
                        patchQuery({
                          limit:
                            Number.isInteger(parsed) && parsed >= 1 && parsed <= 50
                              ? parsed
                              : undefined
                        })
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {hasTimeAxis && (
                  <SwitchRow
                    label="Cumulative"
                    checked={query.cumulative}
                    onChange={(cumulative) => patchQuery({ cumulative })}
                  />
                )}
                {(draft.type === 'bar' || draft.type === 'area') && query.groupBy !== 'none' && (
                  <SwitchRow
                    label="Stacked"
                    checked={config.display?.stacked ?? false}
                    onChange={(stacked) => patchDisplay({ stacked })}
                  />
                )}
                {draft.type === 'pie' && (
                  <SwitchRow
                    label="Donut"
                    checked={config.display?.donut ?? false}
                    onChange={(donut) => patchDisplay({ donut })}
                  />
                )}
                {(isChart || draft.type === 'pie') && (
                  <SwitchRow
                    label="Legend"
                    checked={config.display?.showLegend ?? false}
                    onChange={(showLegend) => patchDisplay({ showLegend })}
                  />
                )}
              </div>
            </div>
          )}

          {/* filters */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Filters</h4>
            <Select
              value={filters.mode}
              onValueChange={(mode) =>
                setDraft((d) => ({
                  ...d,
                  config: {
                    ...d.config,
                    filters: { ...d.config.filters, mode: mode as 'inherit' | 'own' }
                  }
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit report filters, with overrides</SelectItem>
                <SelectItem value="own">Independent of report filters</SelectItem>
              </SelectContent>
            </Select>

            <div className="space-y-3">
              <OverrideRow
                label="Date range"
                active={overrides.dateRange !== undefined}
                onToggle={(on) => patchOverrides({ dateRange: on ? base.dateRange : undefined })}
              >
                <DateRangeControl
                  value={overrides.dateRange ?? base.dateRange}
                  disabled={overrides.dateRange === undefined}
                  onChange={(dateRange) => patchOverrides({ dateRange })}
                />
              </OverrideRow>

              <OverrideRow
                label="Accounts"
                active={overrides.accountIds !== undefined}
                onToggle={(on) =>
                  patchOverrides({ accountIds: on ? (base.accountIds ?? []) : undefined })
                }
              >
                <AccountsControl
                  value={overrides.accountIds ?? base.accountIds}
                  disabled={overrides.accountIds === undefined}
                  onChange={(accountIds) => patchOverrides({ accountIds: accountIds ?? [] })}
                />
              </OverrideRow>

              <OverrideRow
                label="Categories"
                active={
                  overrides.categoryIds !== undefined ||
                  overrides.includeUncategorized !== undefined
                }
                onToggle={(on) =>
                  patchOverrides({
                    categoryIds: on ? (base.categoryIds ?? []) : undefined,
                    includeUncategorized: on ? base.includeUncategorized : undefined
                  })
                }
              >
                <CategoriesControl
                  value={{
                    categoryIds: overrides.categoryIds ?? base.categoryIds,
                    includeUncategorized:
                      overrides.includeUncategorized ?? base.includeUncategorized
                  }}
                  disabled={
                    overrides.categoryIds === undefined &&
                    overrides.includeUncategorized === undefined
                  }
                  onChange={({ categoryIds, includeUncategorized }) =>
                    patchOverrides({
                      categoryIds: categoryIds ?? [],
                      includeUncategorized: includeUncategorized ?? false
                    })
                  }
                />
              </OverrideRow>

              <OverrideRow
                label="Direction"
                active={overrides.direction !== undefined}
                onToggle={(on) => patchOverrides({ direction: on ? base.direction : undefined })}
              >
                <DirectionControl
                  value={overrides.direction ?? base.direction}
                  disabled={overrides.direction === undefined}
                  onChange={(direction) => patchOverrides({ direction })}
                />
              </OverrideRow>

              <OverrideRow
                label="Amount range"
                active={overrides.amountMin !== undefined || overrides.amountMax !== undefined}
                onToggle={(on) =>
                  patchOverrides({
                    amountMin: on ? (base.amountMin ?? 0) : undefined,
                    amountMax: on ? base.amountMax : undefined
                  })
                }
              >
                <AmountRangeControl
                  min={overrides.amountMin ?? base.amountMin}
                  max={overrides.amountMax ?? base.amountMax}
                  disabled={overrides.amountMin === undefined && overrides.amountMax === undefined}
                  onChange={(amountMin, amountMax) =>
                    patchOverrides({ amountMin: amountMin ?? 0, amountMax })
                  }
                />
              </OverrideRow>

              <OverrideRow
                label="Description contains"
                active={overrides.descriptionSearch !== undefined}
                onToggle={(on) =>
                  patchOverrides({
                    descriptionSearch: on ? (base.descriptionSearch ?? '') : undefined
                  })
                }
              >
                <Input
                  className="h-8 w-full"
                  placeholder="Search text"
                  disabled={overrides.descriptionSearch === undefined}
                  key={`search-${overrides.descriptionSearch ?? 'inherit'}`}
                  defaultValue={overrides.descriptionSearch ?? base.descriptionSearch ?? ''}
                  onBlur={(e) => patchOverrides({ descriptionSearch: e.target.value })}
                />
              </OverrideRow>

              <OverrideRow
                label="Include pending"
                active={overrides.includePending !== undefined}
                onToggle={(on) =>
                  patchOverrides({ includePending: on ? base.includePending : undefined })
                }
              >
                <Switch
                  checked={overrides.includePending ?? base.includePending}
                  disabled={overrides.includePending === undefined}
                  onCheckedChange={(includePending) => patchOverrides({ includePending })}
                />
              </OverrideRow>
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {widget ? 'Save changes' : 'Add widget'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SwitchRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  )
}

function OverrideRow({
  label,
  active,
  onToggle,
  children
}: {
  label: string
  active: boolean
  onToggle: (active: boolean) => void
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={active} onCheckedChange={(v) => onToggle(v === true)} />
        <span className={active ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      </label>
      <div className="pl-6">{children}</div>
    </div>
  )
}
