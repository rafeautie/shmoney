import { useQuery } from '@tanstack/react-query'

/**
 * Which currency an amount field is denominated in: the account's own when the
 * field belongs to one, otherwise the currency most of the user's accounts use
 * — the best guess for cross-account fields (filter ranges, rule thresholds),
 * which compare a bare number against every account alike. USD until accounts
 * load, matching the rest of the app's fallback.
 */
export function useAccountCurrency(accountId?: number | null): string {
  const { data } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const accounts = data ?? []

  if (accountId != null) {
    const account = accounts.find((a) => a.id === accountId)
    if (account) return account.currency
  }

  const counts = new Map<string, number>()
  for (const account of accounts) {
    counts.set(account.currency, (counts.get(account.currency) ?? 0) + 1)
  }
  let dominant = 'USD'
  let best = 0
  for (const [currency, count] of counts) {
    if (count > best) {
      dominant = currency
      best = count
    }
  }
  return dominant
}
