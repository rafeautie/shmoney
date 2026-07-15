import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ipcErrorMessage } from '@/lib/utils'

// Developer-only diagnostics. Three layers keep this out of production builds:
// this route redirects away when not dev, the nav entry is hidden (see nav-main),
// and the raw-accounts IPC it calls is only registered in dev (see main/ipc/debug).
export const Route = createFileRoute('/debug')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw redirect({ to: '/accounts' })
  },
  component: DebugPage
})

function DebugPage() {
  // Live network passthrough — refetch on demand rather than on every focus.
  const raw = useQuery({
    queryKey: ['debug', 'rawAccounts'],
    queryFn: () => window.api.debug.rawAccounts(),
    retry: false,
    refetchOnWindowFocus: false
  })
  const connection = useQuery({
    queryKey: ['debug', 'connection'],
    queryFn: () => window.api.connection.get()
  })
  const accounts = useQuery({
    queryKey: ['debug', 'accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const settings = useQuery({
    queryKey: ['debug', 'settings'],
    queryFn: () => window.api.settings.getAll()
  })

  const env = {
    mode: import.meta.env.MODE,
    versions: window.api.debug.versions,
    userAgent: navigator.userAgent
  }

  return (
    <Page className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Debug</h2>
        <p className="text-muted-foreground">
          Developer-only diagnostics. This page is hidden and unreachable in production builds.
        </p>
      </div>

      <JsonCard
        title="Raw accounts response"
        description="Live SimpleFIN /accounts payload (last 90 days), fetched fresh and never stored."
        data={raw.data}
        isFetching={raw.isFetching}
        error={raw.error}
        onRefresh={() => raw.refetch()}
      />
      <JsonCard
        title="Connection"
        description="Stored connection metadata (the encrypted access key never crosses IPC)."
        data={connection.data}
        isFetching={connection.isLoading}
        error={connection.error}
      />
      <JsonCard
        title="Stored accounts"
        description="Accounts as persisted after the last sync. Compare against the raw payload above."
        data={accounts.data}
        isFetching={accounts.isLoading}
        error={accounts.error}
      />
      <JsonCard
        title="Settings"
        description="All persisted settings."
        data={settings.data}
        isFetching={settings.isLoading}
        error={settings.error}
      />
      <JsonCard
        title="Environment"
        description="Renderer mode and runtime versions."
        data={env}
      />
    </Page>
  )
}

function JsonCard({
  title,
  description,
  data,
  isFetching,
  error,
  onRefresh
}: {
  title: string
  description: string
  data: unknown
  isFetching?: boolean
  error?: unknown
  onRefresh?: () => void
}) {
  const json = data === undefined ? '' : JSON.stringify(data, null, 2)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="flex gap-1">
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
              <HugeiconsIcon icon={Refresh01Icon} />
              {isFetching ? 'Fetching…' : 'Refresh'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!json}
            onClick={() => navigator.clipboard.writeText(json)}
          >
            <HugeiconsIcon icon={Copy01Icon} />
            Copy
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{ipcErrorMessage(error)}</p>
        ) : isFetching && !json ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          // Styled ScrollArea (not a native scrollbar) for vertical overflow. The
          // pre wraps long lines/tokens so nothing is ever wider than the viewport
          // — that was the source of the whole-page horizontal overflow.
          <ScrollArea className="rounded-md bg-muted/50" viewPortClassName="max-h-96">
            <pre className="p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {json || 'null'}
            </pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
