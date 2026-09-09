import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Narrowed to one currency: the first pick fixes the rest. */
export function GoalAccountPicker({
  selected,
  onChange,
  modal,
  placeholder
}: {
  selected: { id: number; name: string }[]
  onChange: (accounts: { id: number; name: string }[]) => void
  /** set inside a dialog, whose scroll lock would otherwise swallow the list */
  modal?: boolean
  /** shown instead of the missing-account warning while a goal is being drafted */
  placeholder?: string
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

  const empty = selected.length === 0
  const label = empty
    ? (placeholder ?? 'No linked account')
    : selected.length === 1
      ? selected[0].name
      : `${selected.length} accounts`

  return (
    <Popover modal={modal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="w-full justify-between font-normal" />}
      >
        <span
          className={cn(
            'truncate',
            empty && (placeholder === undefined ? 'text-destructive' : 'text-muted-foreground')
          )}
        >
          {label}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
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
