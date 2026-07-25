import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import type { Category } from '@shared/ipc'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

interface CategoryPickerProps {
  /** Category to mark with a check; omit when there is no single current value (e.g. bulk edit) */
  selectedCategoryId?: number | null
  disabled?: boolean
  onSelect: (categoryId: number | null) => void
}

/** Searchable category list for popovers; fetches categories on mount */
export function CategoryPicker({ selectedCategoryId, disabled, onSelect }: CategoryPickerProps) {
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })

  const item = (category: Category, groupName: string) => (
    <CommandItem
      key={category.id}
      value={`${groupName} ${category.name}`}
      disabled={disabled}
      onSelect={() => onSelect(category.id)}
    >
      {category.name}
      {selectedCategoryId === category.id && (
        <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
      )}
    </CommandItem>
  )

  return (
    <Command>
      <CommandInput placeholder="Search categories..." />
      <CommandList>
        <CommandEmpty>No categories found.</CommandEmpty>
        <CommandGroup>
          <CommandItem value="Uncategorized" disabled={disabled} onSelect={() => onSelect(null)}>
            <span className="text-muted-foreground">Uncategorized</span>
            {selectedCategoryId === null && (
              <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
            )}
          </CommandItem>
        </CommandGroup>
        {categoriesQuery.data?.groups.map((group) => (
          <CommandGroup key={group.id} heading={group.name}>
            {group.categories.map((category) => item(category, group.name))}
          </CommandGroup>
        ))}
        {categoriesQuery.data && categoriesQuery.data.ungrouped.length > 0 && (
          <CommandGroup heading="Ungrouped">
            {categoriesQuery.data.ungrouped.map((category) => item(category, 'Ungrouped'))}
          </CommandGroup>
        )}
        {categoriesQuery.data && categoriesQuery.data.system.length > 0 && (
          <CommandGroup heading="System">
            {categoriesQuery.data.system.map((category) => item(category, 'System'))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
