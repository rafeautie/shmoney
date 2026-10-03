import { useEffect, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AccountMenuButton, AccountName } from '@/components/accounts/account-menu'
import { Amount } from '@/components/amount'
import { NotFoundScreen } from '@/components/error-screen'
import { AccountGoalsStrip } from '@/components/goals/account-goals-strip'
import { AutoCategorizeButton } from '@/components/transactions/auto-categorize-button'
import { CreateTransactionButton } from '@/components/transactions/create-transaction-button'
import { FilteredTotal } from '@/components/transactions/filtered-total'
import { FilteredTransactionsTable } from '@/components/transactions/filtered-transactions-table'
import { useTransactionFilters } from '@/lib/transaction-filters'
import { accountOptions } from '@/lib/queries'
import { HoldingsTable } from '@/components/accounts/holdings-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/accounts/$accountId')({
  loader: async ({ context, params }) => {
    const id = Number(params.accountId)
    if (!Number.isInteger(id) || id <= 0) throw notFound()
    if (!(await context.queryClient.ensureQueryData(accountOptions(id)))) throw notFound()
  },
  component: AccountDetailPage,
  notFoundComponent: AccountNotFound
})

function AccountNotFound() {
  return (
    <NotFoundScreen
      title="Account not found"
      description="This account may have been deleted."
      backTo="/accounts"
      backLabel="Back to Accounts"
    />
  )
}

function AccountDetailPage() {
  const { accountId } = Route.useParams()
  const id = Number(accountId)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // controlled so the Create button can jump to the transactions tab
  const [tab, setTab] = useState('holdings')

  // the route component is reused across accounts; each account starts fresh
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wholesale reset on param change is the point
    setCreating(false)
    setRenaming(false)
    setTab('holdings')
  }, [id])

  const accountQuery = useQuery(accountOptions(id))
  const account = accountQuery.data
  const hasHoldings = (account?.holdingsCount ?? 0) > 0
  // on holdings accounts the table (and so its filter bar) lives behind a tab
  const showingTransactions = !hasHoldings || tab === 'transactions'

  const filterState = useTransactionFilters({ lockedAccount: true })
  const transactionsTable = (
    <FilteredTransactionsTable
      filterState={filterState}
      queryKey={['accounts', id, 'transactions']}
      fetchPage={(query) => window.api.accounts.transactions({ accountId: id, ...query })}
      lockedAccount
      showCreateRow={creating}
      createAccountId={id}
      className="min-h-0 flex-1"
    />
  )

  if (accountQuery.isSuccess && !account) return <AccountNotFound />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        {/* bottom-aligned: the title block leads with 2xl text and the total
            with its label, so aligning tops would leave the amount floating
            between the two lines on the left. Bottom edges put its baseline on
            the balance's. */}
        <div className="flex items-end gap-8">
          <div>
            {/* the account's own name and institution, not page furniture */}
            <AccountName
              accountId={id}
              name={account?.name ?? 'Account'}
              editing={renaming && account !== undefined}
              onDone={() => setRenaming(false)}
            />
            <p className="text-muted-foreground select-text">
              {account && (
                <>
                  {account.institutionName ? `${account.institutionName} · ` : ''}
                  <Amount value={account.balance} currency={account.currency} />
                </>
              )}
            </p>
            <AccountGoalsStrip accountId={id} />
          </div>
          {showingTransactions && <FilteredTotal filterState={filterState} accountId={id} />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CreateTransactionButton
            creating={creating}
            onToggle={() => {
              setCreating(!creating)
              if (!creating) setTab('transactions')
            }}
          />
          <AutoCategorizeButton scope={{ accountId: id }} />
          {account && (
            <AccountMenuButton
              accountId={id}
              accountName={account.name}
              isManual={account.connectionId === null}
              onRename={() => setRenaming(true)}
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
