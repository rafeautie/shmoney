import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table'
import type { Connection } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ipcErrorMessage, pageQuery } from '@/lib/utils'
import { DataTable, DataTableColumnHeader } from '@/components/data-table'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'

export const Route = createFileRoute('/settings')({
  component: SettingsPage
})

function SettingsPage() {
  const queryClient = useQueryClient()

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const query = pageQuery(sorting, pagination, { id: 'name' as const, desc: false })

  const connectionsQuery = useQuery({
    queryKey: ['connections', query],
    queryFn: () => window.api.connections.list(query),
    placeholderData: keepPreviousData
  })

  const [name, setName] = useState('')
  const [setupToken, setSetupToken] = useState('')

  const syncConnection = useMutation({
    mutationFn: (id: number) => window.api.connections.sync(id),
    onSettled: () => queryClient.invalidateQueries()
  })

  const createConnection = useMutation({
    mutationFn: () => window.api.connections.create({ name, setupToken }),
    onSuccess: (connection) => {
      setName('')
      setSetupToken('')
      queryClient.invalidateQueries()
      syncConnection.mutate(connection.id)
    }
  })

  const removeConnection = useMutation({
    mutationFn: (id: number) => window.api.connections.remove(id),
    onSuccess: () => queryClient.invalidateQueries()
  })

  const columns = useMemo<ColumnDef<Connection>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            to="/connections/$connectionId"
            params={{ connectionId: String(row.original.id) }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        )
      },
      {
        accessorKey: 'lastSyncedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last synced" />,
        cell: ({ row }) =>
          row.original.lastSyncedAt
            ? new Date(row.original.lastSyncedAt * 1000).toLocaleString()
            : 'Never'
      },
      {
        id: 'actions',
        enableSorting: false,
        header: '',
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              disabled={syncConnection.isPending}
              onClick={() => syncConnection.mutate(row.original.id)}
            >
              {syncConnection.isPending && syncConnection.variables === row.original.id
                ? 'Syncing...'
                : 'Sync'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={removeConnection.isPending}
              onClick={() => removeConnection.mutate(row.original.id)}
            >
              Delete
            </Button>
          </div>
        )
      }
    ],
    [removeConnection, syncConnection]
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage how shmoney connects to your banks.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add connection</CardTitle>
          <CardDescription>
            Paste a setup token from your SimpleFIN bridge. It is exchanged once for an access key
            stored encrypted on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="connection-name">Name</Label>
            <Input
              id="connection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Bank"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="connection-token">Setup token</Label>
            <Input
              id="connection-token"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Base64 setup token"
            />
          </div>
          {createConnection.isError && (
            <p className="text-sm text-destructive">{ipcErrorMessage(createConnection.error)}</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            disabled={!name.trim() || !setupToken.trim() || createConnection.isPending}
            onClick={() => createConnection.mutate()}
          >
            {createConnection.isPending
              ? 'Connecting...'
              : syncConnection.isPending && createConnection.isSuccess
                ? 'Syncing...'
                : 'Connect'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {syncConnection.isError && (
            <p className="text-sm text-destructive">
              Sync failed: {ipcErrorMessage(syncConnection.error)}
            </p>
          )}
          <DataTable
            columns={columns}
            data={connectionsQuery.data?.rows ?? []}
            total={connectionsQuery.data?.total ?? 0}
            sorting={sorting}
            onSortingChange={setSorting}
            pagination={pagination}
            onPaginationChange={setPagination}
            isLoading={connectionsQuery.isLoading}
            emptyMessage="No connections yet."
          />
        </CardContent>
      </Card>
    </div>
  )
}
