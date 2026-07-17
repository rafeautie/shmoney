import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon, Wallet01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { InputGroupButton } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * The composer's account scope: which account the conversation (and its query
 * tool) is narrowed to. Single-select variant of the reports AccountsControl;
 * null = all accounts.
 */
export function ChatScopeSelect({
  value,
  onChange,
  disabled
}: {
  value: number | null
  onChange: (accountId: number | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const accounts = accountsQuery.data ?? []
  const selected = value === null ? undefined : accounts.find((a) => a.id === value)

  const pick = (accountId: number | null) => {
    onChange(accountId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            variant="ghost"
            size="sm"
            type="button"
            disabled={disabled}
            className="rounded-lg font-normal text-muted-foreground"
          />
        }
      >
        <HugeiconsIcon icon={Wallet01Icon} strokeWidth={2} />
        <span className="max-w-40 truncate">{selected?.name ?? 'All accounts'}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all-accounts" onSelect={() => pick(null)}>
                <span className={cn(value !== null && 'text-muted-foreground')}>All accounts</span>
                {value === null && (
                  <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                )}
              </CommandItem>
            </CommandGroup>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`${account.institutionName ?? ''} ${account.name}`}
                  onSelect={() => pick(account.id)}
                >
                  <span className="truncate">{account.name}</span>
                  {value === account.id && (
                    <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
