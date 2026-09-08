import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

/** "Backing: Emergency fund (62%)" under an account's balance. */
export function AccountGoalsStrip({ accountId }: { accountId: number }) {
  const { data: goals } = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list()
  })

  const backing = (goals ?? []).filter(
    (goal) => goal.archivedAt === null && goal.accounts.some((a) => a.id === accountId)
  )
  if (backing.length === 0) return null

  return (
    <p className="text-xs text-muted-foreground">
      Backing:{' '}
      <Link to="/goals" className="underline underline-offset-2">
        {backing
          .map((goal) => {
            const pct =
              goal.targetAmount > 0 ? Math.round((goal.progress / goal.targetAmount) * 100) : 0
            return `${goal.name} (${pct}%)`
          })
          .join(', ')}
      </Link>
    </p>
  )
}
