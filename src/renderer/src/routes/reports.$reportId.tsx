import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Layout } from 'react-grid-layout'

import { HugeiconsIcon } from '@hugeicons/react'
import { DashboardSquare01Icon, MoreVerticalIcon } from '@hugeicons/core-free-icons'
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { ReportGrid } from '@/components/reports/report-grid'
import { CHROME_ENTER, CHROME_FADE, CHROME_FADE_MS } from '@/components/reports/edit-chrome'
import { FilterBar } from '@/components/transactions/filter-bar'
import { AddWidgetButton, WidgetEditor } from '@/components/reports/widget-editor'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NotFoundScreen } from '@/components/error-screen'
import { reportOptions } from '@/lib/queries'
import { usePresence } from '@/lib/use-presence'
import { cn } from '@/lib/utils'

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
      title="Report not found"
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
  const [editing, setEditing] = useState(false)
  const addPresent = usePresence(editing, CHROME_FADE_MS)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorWidget, setEditorWidget] = useState<ReportWidget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const detailQuery = useQuery(reportOptions(id))
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
      <Page>
        <p className="text-sm text-muted-foreground">Loading…</p>
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
    <Page className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {/* the title and its rename field share one cell and crossfade */}
        <div className="grid min-w-0 flex-1 items-center *:col-start-1 *:row-start-1">
          <Input
            // reseeds on every entry, so an abandoned draft never lingers
            key={`${detail.report.name}-${editing}`}
            defaultValue={detail.report.name}
            inert={!editing}
            className={cn(
              'h-8 max-w-sm text-lg font-semibold',
              CHROME_FADE,
              !editing && 'opacity-0'
            )}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== detail.report.name) renameMutation.mutate(name)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <h2
            inert={editing}
            className={cn(
              'truncate text-2xl font-semibold tracking-tight select-text',
              CHROME_FADE,
              editing && 'opacity-0'
            )}
          >
            {detail.report.name}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {addPresent && (
            <div inert={!editing} className={cn(CHROME_ENTER, !editing && 'opacity-0')}>
              <AddWidgetButton
                reportId={id}
                reportFilters={detail.report.filters}
                nextPosition={nextPosition}
              />
            </div>
          )}
          <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
              <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
              <span className="sr-only">Report menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
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
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={DashboardSquare01Icon} />
            </EmptyMedia>
            <EmptyTitle>This report is empty</EmptyTitle>
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
