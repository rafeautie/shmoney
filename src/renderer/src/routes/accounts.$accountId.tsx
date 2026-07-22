import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AccountSettingsDialog } from '@/components/account-settings-dialog'
import { Amount } from '@/components/amount'
import { AutoCategorizeButton } from '@/components/auto-categorize-button'
import { FilteredTransactionsTable } from '@/components/filtered-transactions-table'
import { HoldingsTable } from '@/components/holdings-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountDetailPage
})

function AccountDetailPage() {
  const { accountId } = Route.useParams()
  const id = Number(accountId)

  const accountQuery = useQuery({
    queryKey: ['accounts', 'detail', id],
    queryFn: () => window.api.accounts.get(id)
  })
  const account = accountQuery.data
  const hasHoldings = (account?.holdingsCount ?? 0) > 0

  const transactionsTable = (
    <FilteredTransactionsTable
      queryKey={['accounts', id, 'transactions']}
      fetchPage={(query) => window.api.accounts.transactions({ accountId: id, ...query })}
      lockedAccount
      showCreateRow
      createAccountId={id}
      className="min-h-0 flex-1"
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{account?.name ?? 'Account'}</h2>
          <p className="text-muted-foreground">
            {account && (
              <>
                {account.institutionName ? `${account.institutionName} · ` : ''}
                <Amount value={account.balance} currency={account.currency} />
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AutoCategorizeButton scope={{ accountId: id }} />
          {account && (
            <AccountSettingsDialog
              accountId={id}
              accountName={account.name}
              isManual={account.connectionId === null}
              invertBalance={account.invertBalance}
            />
          )}
        </div>
      </div>

      {hasHoldings && account ? (
        <Tabs defaultValue="holdings" className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="px-6">
            <TabsList>
              <TabsTrigger value="holdings">Holdings</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="holdings" className="flex min-h-0 flex-1 flex-col">
            <HoldingsTable accountId={id} currency={account.currency} />
          </TabsContent>
          <TabsContent value="transactions" className="flex min-h-0 flex-1 flex-col">
            {transactionsTable}
          </TabsContent>
        </Tabs>
      ) : (
        transactionsTable
      )}
    </div>
  )
}
