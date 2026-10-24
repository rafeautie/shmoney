import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  PencilEdit01Icon
} from '@hugeicons/core-free-icons'
import { format } from 'date-fns'
import type { ReportCreateInput, ReportSummary } from '@shared/reports'
import { SAVINGS_GOALS_TEMPLATE, SPENDING_OVERVIEW_TEMPLATE } from '@shared/report-templates'
import { reportsOptions } from '@/lib/queries'
import { Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NameDialog } from '@/components/name-dialog'
import { WidgetCard } from '@/components/reports/widget-card'

export const Route = createFileRoute('/reports/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsOptions),
  component: ReportsPage
})

function ReportsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reportsQuery = useQuery(reportsOptions)

  const createMutation = useMutation({
    mutationFn: (input: ReportCreateInput) => window.api.reports.create(input),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      navigate({ to: '/reports/$reportId', params: { reportId: String(report.id) } })
    }
  })

  const [deleteTarget, setDeleteTarget] = useState<ReportSummary | null>(null)
  const deleteMutation = useMutation({
    mutationFn: (id: number) => window.api.reports.delete(id),
    onSuccess: () => setDeleteTarget(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['reports'] })
  })

  const [renameTarget, setRenameTarget] = useState<ReportSummary | null>(null)
  const renameMutation = useMutation({
    meta: { silenceError: true },
    mutationFn: (input: { id: number; name: string }) => window.api.reports.update(input),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['report', report.id] })
    }
  })

  const reports = reportsQuery.data ?? []

  return (
    <Page className="space-y-6">
      <PageHeader
        title="Reports"
        description="Build custom dashboards of charts and tables over your transactions."
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button disabled={createMutation.isPending} />}>
            New Report
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
          </DropdownMenuTrigger>
          {/* the menu defaults to the trigger's width, which wraps the template
              item's label; let it size to its content instead */}
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onClick={() => createMutation.mutate({ name: 'Untitled Report' })}>
              Blank Report
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => createMutation.mutate(SPENDING_OVERVIEW_TEMPLATE)}>
              Spending Overview Template
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => createMutation.mutate(SAVINGS_GOALS_TEMPLATE)}>
              Savings Goals Template
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      {reportsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Analytics01Icon} />
            </EmptyMedia>
            <EmptyTitle>No Reports Yet</EmptyTitle>
            <EmptyDescription>
              Create a report to analyze your spending with charts, tables, and stat cards you
              arrange yourself.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button
              onClick={() => createMutation.mutate(SPENDING_OVERVIEW_TEMPLATE)}
              disabled={createMutation.isPending}
            >
              Start with Spending Overview
            </Button>
            <Button
              variant="outline"
              onClick={() => createMutation.mutate(SAVINGS_GOALS_TEMPLATE)}
              disabled={createMutation.isPending}
            >
              Start with Savings Goals
            </Button>
            <Button
              variant="outline"
              onClick={() => createMutation.mutate({ name: 'Untitled Report' })}
              disabled={createMutation.isPending}
            >
              Blank Report
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onOpen={() =>
                navigate({ to: '/reports/$reportId', params: { reportId: String(report.id) } })
              }
              onRename={() => setRenameTarget(report)}
              onDelete={() => setDeleteTarget(report)}
            />
          ))}
        </div>
      )}

      {/* outside the cards: a dialog's clicks bubble through React to its
          parent, and a card's click opens the report */}
      {renameTarget && (
        <NameDialog
          open
          onOpenChange={(open) => !open && setRenameTarget(null)}
          title="Rename Report"
          name={renameTarget.name}
          onSave={(name) => renameMutation.mutateAsync({ id: renameTarget.id, name })}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete “${deleteTarget.name}”?`}
          description="This permanently deletes the report and all its widgets."
          pending={deleteMutation.isPending}
          pendingLabel="Deleting…"
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      )}
    </Page>
  )
}

function ReportCard({
  report,
  onOpen,
  onRename,
  onDelete
}: {
  report: ReportSummary
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <Card className="cursor-pointer gap-2 transition-colors hover:bg-tray" onClick={onOpen}>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="min-w-0 flex-1 truncate text-base select-text">
          {report.name}
        </CardTitle>
        <ActionsMenu label="Report Actions" onTriggerClick={(e) => e.stopPropagation()}>
          <ActionsMenuItem icon={PencilEdit01Icon} onClick={onRename}>
            Rename
          </ActionsMenuItem>
          <ActionsMenuItem icon={Delete02Icon} destructive onClick={onDelete}>
            Delete
          </ActionsMenuItem>
        </ActionsMenu>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <ReportPreview report={report} />
        <div>
          {report.widgetCount} widget{report.widgetCount === 1 ? '' : 's'} · updated{' '}
          {format(new Date(report.updatedAt * 1000), 'MMM d, yyyy')}
        </div>
      </CardContent>
    </Card>
  )
}

/** The first widget at half scale. It lays out at twice the box's size so the
 * chart draws exactly as it would on the report, then shrinks to fit. */
function ReportPreview({ report }: { report: ReportSummary }) {
  if (!report.preview) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md bg-tray text-xs">
        No widgets yet
      </div>
    )
  }
  return (
    <div className="relative h-32 overflow-hidden rounded-md bg-tray" inert aria-hidden>
      <div className="absolute top-2 left-2 h-[calc(200%-2rem)] w-[calc(200%-2rem)] origin-top-left scale-50">
        <WidgetCard widget={report.preview} reportFilters={report.filters} editing={false} />
      </div>
    </div>
  )
}
