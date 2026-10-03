import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ipcErrorMessage } from '@/lib/utils'
import { connectionOptions } from '@/lib/queries'
import { useOnboarding } from '@/lib/settings'
import { useConnectSimpleFin } from '@/hooks/use-connect-simplefin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsGroup, SettingAction, SettingsSection } from './settings-controls'
import { ConfirmButton } from '@/components/confirm-dialog'
import { ConnectionAlerts } from '@/components/connection/connection-alerts'

export function ConnectionSettings() {
  const queryClient = useQueryClient()

  const connectionQuery = useQuery(connectionOptions)
  const connection = connectionQuery.data

  const { setupToken, setSetupToken, connect, syncConnection } = useConnectSimpleFin()
  const { onboardingComplete, resetOnboarding } = useOnboarding()

  const disconnect = useMutation({
    mutationFn: () => window.api.connection.disconnect(),
    onSuccess: () => queryClient.invalidateQueries()
  })

  if (connectionQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!connection) {
    return (
      <SettingsSection
        title="Connect SimpleFIN"
        description="Paste a setup token from your SimpleFIN bridge. It is exchanged once for an access key stored encrypted on this device."
      >
        <SettingsGroup>
          <div className="flex items-center gap-2 px-4 py-3">
            <Label htmlFor="setup-token" className="sr-only">
              Setup token
            </Label>
            <Input
              id="setup-token"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Base64 setup token"
              className="flex-1"
            />
            <Button
              className="shrink-0"
              disabled={!setupToken.trim() || connect.isPending}
              onClick={() => connect.mutate()}
            >
              {connect.isPending
                ? 'Connecting…'
                : syncConnection.isPending && connect.isSuccess
                  ? 'Syncing…'
                  : 'Connect'}
            </Button>
          </div>
          <SettingAction
            label="Getting started guide"
            description="Replay the first-run walkthrough."
          >
            <Button variant="outline" onClick={resetOnboarding} disabled={!onboardingComplete}>
              Show again
            </Button>
          </SettingAction>
        </SettingsGroup>
        {connect.isError && (
          <p className="text-sm text-destructive">{ipcErrorMessage(connect.error)}</p>
        )}
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      title="SimpleFIN"
      description={
        <>
          Connected.{' '}
          {connection.lastSyncedAt
            ? `Last synced ${format(new Date(connection.lastSyncedAt * 1000), 'MMM d, yyyy, p')}.`
            : 'Never synced.'}
        </>
      }
    >
      <ConnectionAlerts connection={connection} />
      {disconnect.isError && (
        <p className="text-sm text-destructive">
          Disconnect failed: {ipcErrorMessage(disconnect.error)}
        </p>
      )}
      <SettingsGroup>
        <SettingAction label="Sync now" description="Fetch the latest balances and transactions.">
          <Button disabled={syncConnection.isPending} onClick={() => syncConnection.mutate()}>
            {syncConnection.isPending ? 'Syncing…' : 'Sync'}
          </Button>
        </SettingAction>
        <SettingAction
          label="Getting started guide"
          description="Replay the first-run walkthrough."
        >
          <Button variant="outline" onClick={resetOnboarding} disabled={!onboardingComplete}>
            Show again
          </Button>
        </SettingAction>
        <SettingAction
          label="Disconnect"
          description="Forget the SimpleFIN access key. Synced accounts and their transactions stay on this device."
        >
          <ConfirmButton
            variant="outline"
            title="Disconnect SimpleFIN?"
            description="Syncing stops and the access key is removed. Your accounts, transactions and categories are kept; reconnecting picks them back up."
            confirmLabel="Disconnect"
            pendingLabel="Disconnecting…"
            pending={disconnect.isPending}
            onConfirm={(close) => disconnect.mutate(undefined, { onSuccess: close })}
          >
            Disconnect
          </ConfirmButton>
        </SettingAction>
      </SettingsGroup>
    </SettingsSection>
  )
}
