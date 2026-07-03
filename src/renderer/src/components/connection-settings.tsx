import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ipcErrorMessage } from '@/lib/utils'
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

export function ConnectionSettings() {
  const queryClient = useQueryClient()

  const connectionQuery = useQuery({
    queryKey: ['connection'],
    queryFn: () => window.api.connection.get()
  })
  const connection = connectionQuery.data

  const [setupToken, setSetupToken] = useState('')
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const syncConnection = useMutation({
    mutationFn: () => window.api.connection.sync(),
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
        {confirmingDisconnect && (
          <p className="text-sm text-destructive">
            Disconnecting deletes all synced accounts and transactions from this device.
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={syncConnection.isPending} onClick={() => syncConnection.mutate()}>
          {syncConnection.isPending ? 'Syncing...' : 'Sync'}
        </Button>
        {confirmingDisconnect ? (
          <>
            <Button
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              {disconnect.isPending ? 'Disconnecting...' : 'Yes, disconnect'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDisconnect(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setConfirmingDisconnect(true)}>
            Disconnect
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
