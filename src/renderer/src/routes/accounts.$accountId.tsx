import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon } from '@hugeicons/core-free-icons'
import { AccountSettingsDialog } from '@/components/account-settings-dialog'
import { Amount } from '@/components/amount'
import { AutoCategorizeButton } from '@/components/auto-categorize-button'
import { FilteredTransactionsTable } from '@/components/filtered-transactions-table'
import { HoldingsTable } from '@/components/holdings-table'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountDetailPage
})

function AccountDetailPage() {
  const { accountId } = Route.useParams()
  const id = Number(accountId)
  const [creating, setCreating] = useState(false)
  // controlled so the Create button can jump to the transactions tab
  const [tab, setTab] = useState('holdings')

  // the route component is reused across accounts; each account starts fresh
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wholesale reset on param change is the point
    setCreating(false)
    setTab('holdings')
  }, [id])

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
      showCreateRow={creating}
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
          <Button
            variant={creating ? 'secondary' : 'outline'}
            aria-pressed={creating}
            onClick={() => {
              setCreating(!creating)
              if (!creating) setTab('transactions')
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} />
            Create transaction
          </Button>
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
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-4">
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
