import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

/** Account dropdown for the transaction editor; labels match the import dialog's
 * `Institution · Name` convention. Callers read the selected account's currency
 * from the same ['accounts'] query. */
export function AccountPicker({
  value,
  onChange,
  id
}: {
  value: number | null
  onChange: (accountId: number) => void
  id?: string
}): React.JSX.Element {
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const accounts = accountsQuery.data ?? []
  const label = (account: (typeof accounts)[number]) =>
    `${account.institutionName ? `${account.institutionName} · ` : ''}${account.name}`

  return (
    <Select
      value={value === null ? undefined : String(value)}
      onValueChange={(v) => onChange(Number(v))}
      // without an items map, base-ui's Value renders the raw value until the
      // popup has mounted once — this keeps the trigger showing the label
      items={Object.fromEntries(accounts.map((account) => [String(account.id), label(account)]))}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Select an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            {label(account)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
