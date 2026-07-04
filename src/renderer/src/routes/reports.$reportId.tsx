import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Layout } from 'react-grid-layout'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, MoreVerticalIcon } from '@hugeicons/core-free-icons'
import {
  DEFAULT_REPORT_FILTERS,
  type ReportDetail,
  type ReportFilters,
  type ReportWidget,
  type WidgetLayoutsInput
} from '@shared/reports'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ReportGrid } from '@/components/reports/report-grid'
import { FilterBar } from '@/components/filter-bar'
import { WidgetEditor } from '@/components/reports/widget-editor'

export const Route = createFileRoute('/reports/$reportId')({
  component: ReportPage
})

function ReportPage() {
  const { reportId } = Route.useParams()
  const id = Number(reportId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorWidget, setEditorWidget] = useState<ReportWidget | null>(null)

  const detailQuery = useQuery({
    queryKey: ['report', id],
    queryFn: () => window.api.reports.get(id)
  })
  const detail = detailQuery.data

  // a fresh report has nothing to look at; drop straight into edit mode
  const autoEditedRef = useRef(false)
  useEffect(() => {
    if (detail && detail.widgets.length === 0 && !autoEditedRef.current) {
      autoEditedRef.current = true
      setEditing(true)
    }
  }, [detail])

  // ---- layout persistence: optimistic cache patch + debounced save ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLayout = useRef<Layout | null>(null)
  const layoutMutation = useMutation({
    mutationFn: (input: WidgetLayoutsInput) => window.api.reports.widgetLayouts(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] })
  })

  const mutateLayouts = layoutMutation.mutate
  const flushLayouts = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const layout = pendingLayout.current
    if (!layout) return
    pendingLayout.current = null
    mutateLayouts({
      reportId: id,
      layouts: layout.map((l) => ({ id: Number(l.i), x: l.x, y: l.y, w: l.w, h: l.h }))
    })
  }, [mutateLayouts, id])
  // save anything still pending when leaving the page
  useEffect(() => flushLayouts, [flushLayouts])

  function handleLayoutChange(layout: Layout) {
    if (!editing || !detail) return
    const changed = layout.some((l) => {
      const widget = detail.widgets.find((w) => String(w.id) === l.i)
      return (
        widget && (widget.x !== l.x || widget.y !== l.y || widget.w !== l.w || widget.h !== l.h)
      )
    })
    if (!changed) return
    queryClient.setQueryData<ReportDetail>(['report', id], (prev) =>
      prev
        ? {
            ...prev,
            widgets: prev.widgets.map((widget) => {
              const l = layout.find((l) => l.i === String(widget.id))
              return l ? { ...widget, x: l.x, y: l.y, w: l.w, h: l.h } : widget
            })
          }
        : prev
    )
    pendingLayout.current = layout
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushLayouts, 800)
  }

  // ---- report mutations ----
  const renameMutation = useMutation({
    mutationFn: (name: string) => window.api.reports.update({ id, name }),
    onSuccess: (report) => {
      queryClient.setQueryData<ReportDetail>(['report', id], (prev) =>
        prev ? { ...prev, report } : prev
      )
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: () => window.api.reports.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      navigate({ to: '/reports' })
    }
  })

  const filtersMutation = useMutation({
    mutationFn: (filters: ReportFilters) => window.api.reports.update({ id, filters }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] })
  })

  function handleFiltersChange(filters: ReportFilters) {
    // optimistic: widgets re-query off the cache immediately, save in the background
    queryClient.setQueryData<ReportDetail>(['report', id], (prev) =>
      prev ? { ...prev, report: { ...prev.report, filters } } : prev
    )
    filtersMutation.mutate(filters)
  }

  const deleteWidgetMutation = useMutation({
    mutationFn: (widgetId: number) => window.api.reports.widgetDelete(widgetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['report', id] })
  })

  function openEditor(widget: ReportWidget | null) {
    setEditorWidget(widget)
    setEditorOpen(true)
  }

  if (detailQuery.isLoading) {
    return (
      <Page>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Page>
    )
  }
  if (!detail) {
    return (
      <Page>
        <p className="text-sm text-muted-foreground">Report not found.</p>
      </Page>
    )
  }

  return (
    <Page className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {editing ? (
          <Input
            key={detail.report.name}
            defaultValue={detail.report.name}
            className="h-8 max-w-sm text-lg font-semibold"
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== detail.report.name) renameMutation.mutate(name)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <h2 className="truncate text-2xl font-semibold tracking-tight">{detail.report.name}</h2>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {editing && (
            <Button variant="outline" onClick={() => openEditor(null)}>
              <HugeiconsIcon icon={Add01Icon} size={16} />
              Add widget
            </Button>
          )}
          <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
                <span className="sr-only">Report menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => deleteMutation.mutate()}>
                Delete report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <FilterBar
        filters={detail.report.filters}
        onChange={handleFiltersChange}
        defaultFilters={DEFAULT_REPORT_FILTERS}
      />

      {detail.widgets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            This report is empty. Add a widget to get started.
          </p>
          <Button onClick={() => openEditor(null)}>
            <HugeiconsIcon icon={Add01Icon} size={16} />
            Add widget
          </Button>
        </div>
      ) : (
        <ReportGrid
          widgets={detail.widgets}
          reportFilters={detail.report.filters}
          editing={editing}
          onLayoutChange={handleLayoutChange}
          onEditWidget={openEditor}
          onDeleteWidget={(widget) => deleteWidgetMutation.mutate(widget.id)}
        />
      )}

      <WidgetEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        reportId={id}
        reportFilters={detail.report.filters}
        widget={editorWidget}
        nextPosition={{
          x: 0,
          y: Math.max(0, ...detail.widgets.map((w) => w.y + w.h)),
          w: 6,
          h: 5
        }}
      />
    </Page>
  )
}
