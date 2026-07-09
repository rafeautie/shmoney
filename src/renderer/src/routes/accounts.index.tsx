import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { BankIcon } from '@hugeicons/core-free-icons'
import type { Account } from '@shared/ipc'
import { Amount } from '@/components/amount'
import { AutoCategorizeButton } from '@/components/auto-categorize-button'
import { FilteredTransactionsTable } from '@/components/filtered-transactions-table'
import { TABLE_BLEED, cn, plural } from '@/lib/utils'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
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

// SimpleFIN's available-balance has no fixed meaning across account types
// (available cash for investments, remaining credit for some cards, a copy of
// balance for others) and the protocol carries no account type to disambiguate
// it. So we surface it verbatim, only when it adds signal, and never reinterpret
// its sign — see the tooltip on the Available line below.
function hasDistinctAvailable(account: Account): boolean {
  return account.availableBalance !== null && account.availableBalance !== account.balance
}

function AccountsPage() {
  return (
    <Tabs defaultValue="accounts" className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="space-y-4 px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Accounts</h2>
            <p className="text-muted-foreground">
              Balances grouped by institution, and every transaction across your accounts.
            </p>
          </div>
          {/* empty scope → categorize every uncategorized transaction */}
          <AutoCategorizeButton scope={{}} />
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
        <FilteredTransactionsTable
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
    <TooltipProvider>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 px-6 pb-6 py-1">
          {accountsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : institutions.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={BankIcon} />
                </EmptyMedia>
                <EmptyTitle>No accounts yet</EmptyTitle>
                <EmptyDescription>Connect SimpleFIN in Settings, then sync.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => navigate({ to: '/settings' })}>
                  Go to Settings
                </Button>
              </EmptyContent>
            </Empty>
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
                        <TableHead className="w-48 text-right">Balance</TableHead>
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
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-0.5">
                              <span className="truncate">{account.name}</span>
                              {account.holdingsCount > 0 && (
                                <span className="text-xs font-normal text-muted-foreground">
                                  {plural(account.holdingsCount, 'holding')}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <Amount value={account.balance} currency={account.currency} />
                              {hasDistinctAvailable(account) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">
                                      <Amount
                                        value={account.availableBalance!}
                                        currency={account.currency}
                                        colored={false}
                                        className="text-xs text-muted-foreground"
                                      />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Available balance as reported by your institution. Its meaning
                                    varies by account type — e.g. available cash for investments or
                                    remaining credit for some cards.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
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
    </TooltipProvider>
  )
}
