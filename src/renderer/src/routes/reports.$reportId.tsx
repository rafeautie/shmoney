import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Layout } from 'react-grid-layout'

import { HugeiconsIcon } from '@hugeicons/react'
import { DashboardSquare01Icon, Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import {
  DEFAULT_REPORT_FILTERS,
  type ReportDetail,
  type ReportFilters,
  type ReportWidget,
  type WidgetLayoutsInput
} from '@shared/reports'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { ReportGrid } from '@/components/reports/report-grid'
import { FilterBar } from '@/components/transactions/filter-bar'
import { AddWidgetButton, WidgetEditor } from '@/components/reports/widget-editor'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NameDialog } from '@/components/name-dialog'
import { NotFoundScreen } from '@/components/error-screen'
import { reportOptions } from '@/lib/queries'

export const Route = createFileRoute('/reports/$reportId')({
  loader: async ({ context, params }) => {
    const id = Number(params.reportId)
    if (!Number.isInteger(id) || id <= 0) throw notFound()
    if (!(await context.queryClient.ensureQueryData(reportOptions(id)))) throw notFound()
  },
  component: ReportPage,
  notFoundComponent: ReportNotFound
})

function ReportNotFound() {
  return (
    <NotFoundScreen
      title="Report Not Found"
      description="This report may have been deleted."
      backTo="/reports"
      backLabel="Back to Reports"
    />
  )
}

function ReportPage() {
  const { reportId } = Route.useParams()
  const id = Number(reportId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // arranging: widgets drag and resize; everything else works either way
  const [editing, setEditing] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorWidget, setEditorWidget] = useState<ReportWidget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const detailQuery = useQuery(reportOptions(id))
  const detail = detailQuery.data

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
              if (
                !l ||
                (widget.x === l.x && widget.y === l.y && widget.w === l.w && widget.h === l.h)
              )
                return widget
              return { ...widget, x: l.x, y: l.y, w: l.w, h: l.h }
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
    meta: { silenceError: true },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report', id] })
      // the list previews the first widget
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    }
  })

  function openEditor(widget: ReportWidget) {
    setEditorWidget(widget)
    setEditorOpen(true)
  }

  if (detailQuery.isLoading) {
    return (
      <Page className="space-y-6">
        <Skeleton className="h-7 w-56" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-72 w-full" />
      </Page>
    )
  }
  if (!detail) return <ReportNotFound />

  // where a newly created widget lands: full width, below everything else
  const nextPosition = {
    x: 0,
    y: Math.max(0, ...detail.widgets.map((w) => w.y + w.h)),
    w: 6,
    h: 5
  }

  return (
    <Page className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight select-text">
          {detail.report.name}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {/* an empty report offers the same button in its empty state */}
          {detail.widgets.length > 0 && (
            <AddWidgetButton
              reportId={id}
              reportFilters={detail.report.filters}
              nextPosition={nextPosition}
            />
          )}
          {detail.widgets.length > 0 && (
            <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Arrange'}
            </Button>
          )}
          <ActionsMenu label="Report Actions">
            <ActionsMenuItem icon={PencilEdit01Icon} onClick={() => setRenaming(true)}>
              Rename
            </ActionsMenuItem>
            <ActionsMenuItem icon={Delete02Icon} destructive onClick={() => setConfirmDelete(true)}>
              Delete
            </ActionsMenuItem>
          </ActionsMenu>
        </div>
      </div>

      <FilterBar
        filters={detail.report.filters}
        onChange={handleFiltersChange}
        defaultFilters={DEFAULT_REPORT_FILTERS}
      />

      {detail.widgets.length === 0 ? (
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={DashboardSquare01Icon} />
            </EmptyMedia>
            <EmptyTitle>This Report Is Empty</EmptyTitle>
            <EmptyDescription>Add a widget to get started.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddWidgetButton
              reportId={id}
              reportFilters={detail.report.filters}
              nextPosition={nextPosition}
            />
          </EmptyContent>
        </Empty>
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

      {/* editing an existing widget: the trigger is on the card, so the page
          drives the editor itself */}
      <WidgetEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        reportId={id}
        reportFilters={detail.report.filters}
        widget={editorWidget}
        nextPosition={nextPosition}
      />

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename Report"
        name={detail.report.name}
        onSave={(name) => renameMutation.mutateAsync(name)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${detail.report.name}”?`}
        description="This permanently deletes the report and all its widgets."
        pending={deleteMutation.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => deleteMutation.mutate()}
      />
    </Page>
  )
}
