import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { sfinErrorSeverity, type SfinError } from '@shared/ipc'
import { ipcErrorMessage, plural } from '@/lib/utils'
import { useNotify } from '@/lib/notify-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { ConfirmDialog } from './confirm-dialog'

export function ConnectionSettings() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const notify = useNotify()

  const connectionQuery = useQuery({
    queryKey: ['connection'],
    queryFn: () => window.api.connection.get()
  })
  const connection = connectionQuery.data

  const [setupToken, setSetupToken] = useState('')
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const syncConnection = useMutation({
    mutationFn: () => window.api.connection.sync(),
    // sync applies transfer detection and rules automatically; report what it
    // touched so those silent mutations stay visible and reviewable
    onSuccess: (result) => {
      if (result.detectedTransfers > 0) {
        notify(`Detected ${plural(result.detectedTransfers, 'transfer')}`, {
          description: 'Marked automatically and excluded from income and expenses.',
          action: { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
        })
      }
      if (result.rulesApplied > 0) {
        notify(`Rules updated ${plural(result.rulesApplied, 'transaction')}`, {
          description: 'Applied automatically on sync.',
          action: { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
        })
      }
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  const connect = useMutation({
    mutationFn: () => window.api.connection.connect({ setupToken }),
    onSuccess: () => {
      setSetupToken('')
      queryClient.invalidateQueries()
      syncConnection.mutate()
    }
  })

  const disconnect = useMutation({
    mutationFn: () => window.api.connection.disconnect(),
    onSuccess: () => {
      setConfirmingDisconnect(false)
      queryClient.invalidateQueries()
    }
  })

  if (connectionQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!connection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect SimpleFIN</CardTitle>
          <CardDescription>
            Paste a setup token from your SimpleFIN bridge. It is exchanged once for an access key
            stored encrypted on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="setup-token">Setup token</Label>
            <Input
              id="setup-token"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Base64 setup token"
            />
          </div>
          {connect.isError && (
            <p className="text-sm text-destructive">{ipcErrorMessage(connect.error)}</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            disabled={!setupToken.trim() || connect.isPending}
            onClick={() => connect.mutate()}
          >
            {connect.isPending
              ? 'Connecting...'
              : syncConnection.isPending && connect.isSuccess
                ? 'Syncing...'
                : 'Connect'}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">SimpleFIN</CardTitle>
        <CardDescription>
          Connected.{' '}
          {connection.lastSyncedAt
            ? `Last synced ${new Date(connection.lastSyncedAt * 1000).toLocaleString()}.`
            : 'Never synced.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {connection.lastSyncErrors.length > 0 && (
          <SyncErrorsAlert errors={connection.lastSyncErrors} />
        )}
        {syncConnection.isError && (
          <p className="text-sm text-destructive">
            Sync failed: {ipcErrorMessage(syncConnection.error)}
          </p>
        )}
        {disconnect.isError && (
          <p className="text-sm text-destructive">
            Disconnect failed: {ipcErrorMessage(disconnect.error)}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={syncConnection.isPending} onClick={() => syncConnection.mutate()}>
          {syncConnection.isPending ? 'Syncing...' : 'Sync'}
        </Button>
        <Button variant="outline" onClick={() => setConfirmingDisconnect(true)}>
          Disconnect
        </Button>
      </CardFooter>

      <ConfirmDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
        title="Disconnect SimpleFIN?"
        description="Disconnecting deletes all synced accounts and transactions from this device."
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        pending={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Card>
  )
}

function SyncErrorsAlert({ errors }: { errors: SfinError[] }) {
  // Auth failures need the user to act; retry-advised/bridge notices clear on a
  // later sync, so surface those far more quietly. Developer-facing entries
  // (gen.api) match neither bucket and are intentionally not shown to the user.
  const actionNeeded = errors.filter((e) => sfinErrorSeverity(e) === 'action')
  const transient = errors.filter((e) => sfinErrorSeverity(e) === 'transient')
  return (
    <>
      {actionNeeded.length > 0 && (
        <SyncNotice tone="error" title="SimpleFIN needs your attention" errors={actionNeeded} />
      )}
      {transient.length > 0 && (
        <SyncNotice
          tone="muted"
          title="SimpleFIN couldn’t fetch everything last sync"
          hint="These usually clear on the next sync."
          errors={transient}
        />
      )}
    </>
  )
}

function SyncNotice({
  tone,
  title,
  hint,
  errors
}: {
  tone: 'error' | 'muted'
  title: string
  hint?: string
  errors: SfinError[]
}) {
  const isError = tone === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={
        isError
          ? 'flex gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-destructive dark:bg-destructive/15'
          : 'flex gap-3 rounded-lg border border-border bg-muted/50 p-3 text-muted-foreground'
      }
    >
      <HugeiconsIcon icon={Alert02Icon} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1.5">
        <p className={isError ? 'text-sm font-medium' : 'text-sm font-medium text-foreground'}>
          {title}
        </p>
        {hint && <p className="text-xs">{hint}</p>}
        <ul className={isError ? 'space-y-1 text-sm text-destructive/90' : 'space-y-1 text-sm'}>
          {errors.map((error, i) => (
            <li key={`${error.code}-${i}`} className="leading-snug">
              {error.msg}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
