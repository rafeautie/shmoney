import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Account } from '@shared/ipc'
import { Amount } from '@/components/amount'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

export const Route = createFileRoute('/accounts/')({
  component: AccountsPage
})

function AccountsPage() {
  const navigate = useNavigate()
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })

  // rows arrive ordered by institution then name, so insertion order is stable
  const institutions = useMemo(() => {
    const groups = new Map<string, Account[]>()
    for (const account of accountsQuery.data ?? []) {
      const key = account.institutionName ?? 'Other'
      const group = groups.get(key)
      if (group) {
        group.push(account)
      } else {
        groups.set(key, [account])
      }
    }
    return [...groups.entries()]
  }, [accountsQuery.data])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Accounts</h2>
        <p className="text-muted-foreground">
          Balances across all of your connections, grouped by institution. Select an account to view
          its transactions.
        </p>
      </div>

      {accountsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : institutions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts yet. Add a connection in Settings, then sync it.
        </p>
      ) : (
        institutions.map(([institution, accounts]) => (
          <Card key={institution}>
            <CardHeader>
              <CardTitle className="text-base">{institution}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow
                      key={account.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate({
                          to: '/accounts/$accountId',
                          params: { accountId: String(account.id) }
                        })
                      }
                    >
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell className="text-right">
                        <Amount value={account.balance} currency={account.currency} />
                      </TableCell>
                      <TableCell className="text-right">
                        {account.availableBalance !== null ? (
                          <Amount value={account.availableBalance} currency={account.currency} />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
