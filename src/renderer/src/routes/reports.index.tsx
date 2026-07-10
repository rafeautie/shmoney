import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Analytics01Icon,
  ArrowDown01Icon,
  MoreVerticalIcon
} from '@hugeicons/core-free-icons'
import type { ReportCreateInput, ReportSummary } from '@shared/reports'
import { SPENDING_OVERVIEW_TEMPLATE } from '@/lib/report-templates'
import { Page } from '@/components/page'
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
import { ConfirmDialog } from '@/components/confirm-dialog'

export const Route = createFileRoute('/reports/')({
  component: ReportsPage
})

function ReportsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reportsQuery = useQuery({
    queryKey: ['reports'],
    queryFn: () => window.api.reports.list()
  })

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

  const reports = reportsQuery.data ?? []

  return (
    <Page className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Reports</h2>
          <p className="text-muted-foreground">
            Build custom dashboards of charts and tables over your transactions.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={createMutation.isPending}>
              <HugeiconsIcon icon={Add01Icon} size={16} />
              New report
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => createMutation.mutate({ name: 'Untitled report' })}>
              Blank report
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => createMutation.mutate(SPENDING_OVERVIEW_TEMPLATE)}>
              Spending Overview template
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {reportsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : reports.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Analytics01Icon} />
            </EmptyMedia>
            <EmptyTitle>No reports yet</EmptyTitle>
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
              onClick={() => createMutation.mutate({ name: 'Untitled report' })}
              disabled={createMutation.isPending}
            >
              Blank report
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onOpen={() =>
                navigate({ to: '/reports/$reportId', params: { reportId: String(report.id) } })
              }
              onDelete={() => setDeleteTarget(report)}
            />
          ))}
        </div>
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
  onDelete
}: {
  report: ReportSummary
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <Card className="cursor-pointer gap-2 transition-colors hover:bg-accent/50" onClick={onOpen}>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="min-w-0 flex-1 truncate text-base">{report.name}</CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
              <span className="sr-only">Report menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete report
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {report.widgetCount} widget{report.widgetCount === 1 ? '' : 's'} · updated{' '}
        {new Date(report.updatedAt * 1000).toLocaleDateString()}
      </CardContent>
    </Card>
  )
}
