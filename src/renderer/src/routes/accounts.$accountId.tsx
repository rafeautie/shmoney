import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Amount } from '@/components/amount'
import { AutoCategorizeButton } from '@/components/auto-categorize-button'
import { FilteredTransactionsTable } from '@/components/filtered-transactions-table'

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
        <AutoCategorizeButton scope={{ accountId: id }} />
      </div>

      <FilteredTransactionsTable
        queryKey={['accounts', id, 'transactions']}
        fetchPage={(query) => window.api.accounts.transactions({ accountId: id, ...query })}
        lockedAccount
        className="min-h-0 flex-1"
      />
    </div>
  )
}
