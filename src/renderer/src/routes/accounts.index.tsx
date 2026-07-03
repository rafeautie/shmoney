import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Account } from '@shared/ipc'
import { Amount } from '@/components/amount'
import { TransactionsTable } from '@/components/transactions-table'
import { TABLE_BLEED, cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  return (
    <Tabs defaultValue="accounts" className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="space-y-4 px-6 pt-6 pb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Accounts</h2>
          <p className="text-muted-foreground">
            Balances grouped by institution, and every transaction across your accounts.
          </p>
        </div>
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="transactions">All transactions</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="accounts" className="flex min-h-0 flex-1 flex-col">
        <AccountsList />
      </TabsContent>

      <TabsContent value="transactions" className="flex min-h-0 flex-1 flex-col">
        <TransactionsTable
          queryKey={['transactions']}
          fetchPage={(query) => window.api.transactions.list(query)}
          showAccount
          className="min-h-0 flex-1"
        />
      </TabsContent>
    </Tabs>
  )
}

function AccountsList() {
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
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-6 px-6 pb-6 py-1">
        {accountsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : institutions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No accounts yet. Connect SimpleFIN in Settings, then sync.
          </p>
        ) : (
          institutions.map(([institution, accounts]) => (
            <Card key={institution} className="overflow-hidden pb-0">
              <CardHeader>
                <CardTitle className="text-base">{institution}</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table className={cn(TABLE_BLEED, 'table-fixed')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-40 text-right">Balance</TableHead>
                      <TableHead className="w-40 text-right">Available</TableHead>
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
                        <TableCell className="truncate font-medium">{account.name}</TableCell>
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
    </ScrollArea>
  )
}
