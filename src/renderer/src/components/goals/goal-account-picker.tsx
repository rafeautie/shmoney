import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Which accounts back a goal. Multi-select, and narrowed to one currency: a goal
 * is a scalar amount and can't keep currencies apart, so the first pick fixes
 * the rest (the IPC handler rejects a mixed set anyway).
 */
export function GoalAccountPicker({
  selected,
  onChange
}: {
  selected: { id: number; name: string }[]
  onChange: (accounts: { id: number; name: string }[]) => void
}) {
  const [open, setOpen] = useState(false)
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })

  const selectedIds = selected.map((a) => a.id)
  const currency = (accounts ?? []).find((a) => a.id === selectedIds[0])?.currency
  const pickable = (accounts ?? []).filter((a) => currency === undefined || a.currency === currency)

  const toggle = (account: { id: number; name: string }): void =>
    onChange(
      selectedIds.includes(account.id)
        ? selected.filter((a) => a.id !== account.id)
        : [...selected, { id: account.id, name: account.name }]
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="h-auto px-1 py-0.5 font-normal" />}
      >
        {selected.length === 0 ? (
          <span className="text-xs text-destructive">No linked account</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {selected.map((account) => (
              <Badge key={account.id} variant="secondary" className="font-normal">
                {account.name}
              </Badge>
            ))}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No accounts in this currency.</CommandEmpty>
            {pickable.map((account) => (
              <CommandItem key={account.id} value={account.name} onSelect={() => toggle(account)}>
                <span className="truncate">{account.name}</span>
                {selectedIds.includes(account.id) && (
                  <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
