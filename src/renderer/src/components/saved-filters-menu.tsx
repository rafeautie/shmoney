import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Bookmark01Icon, Delete02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { TransactionFilters } from '@shared/transaction-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

/** Order-insensitive deep-equality key: saved filters round-trip through JSON,
 * so their key order can differ from freshly-built filter objects. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

interface SavedFiltersMenuProps {
  onLoad: (filters: TransactionFilters) => void
  /** the bar's current filters, saved when the user hits Save/Overwrite */
  currentFilters: TransactionFilters
}

/** Save/load named filter presets. Shared by the transactions filter bar and the
 * report filter bar — one pool, so a filter saved anywhere loads everywhere.
 * Presets may reference since-deleted accounts/categories; those ids simply
 * match nothing, so stale presets degrade to fewer results, not errors. */
export function SavedFiltersMenu({ onLoad, currentFilters }: SavedFiltersMenuProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const queryClient = useQueryClient()

  const savedQuery = useQuery({
    queryKey: ['saved-filters'],
    queryFn: () => window.api.savedFilters.list()
  })
  const saved = savedQuery.data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['saved-filters'] })
  const createMutation = useMutation({
    mutationFn: (input: { name: string; filters: TransactionFilters }) =>
      window.api.savedFilters.create(input),
    onSettled: invalidate
  })
  const updateMutation = useMutation({
    mutationFn: (input: { id: number; filters: TransactionFilters }) =>
      window.api.savedFilters.update(input),
    onSettled: invalidate
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => window.api.savedFilters.delete(id),
    onSettled: invalidate
  })

  const trimmed = name.trim()
  // case-insensitive so "groceries" doesn't silently create a near-duplicate
  // of "Groceries"; the DB unique index (case-sensitive) is the backstop
  const existing = saved.find((f) => f.name.toLowerCase() === trimmed.toLowerCase())

  function save() {
    if (!trimmed) return
    if (existing) {
      updateMutation.mutate({ id: existing.id, filters: currentFilters })
    } else {
      createMutation.mutate({ name: trimmed, filters: currentFilters })
    }
    setName('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" className="border-input bg-input/20 font-normal">
          <HugeiconsIcon icon={Bookmark01Icon} size={14} className="text-muted-foreground" />
          Saved
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        {saved.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No saved filters yet. Name the current filter below to save it.
          </p>
        ) : (
          // pb-px: buttons shift down 1px while pressed (active:translate-y-px),
          // which would otherwise overflow the container and flash a scrollbar
          <div className="max-h-64 overflow-y-auto pb-px">
            {saved.map((filter) => (
              <div key={filter.id} className="group flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 flex-1 justify-start font-normal"
                  onClick={() => {
                    onLoad(filter.filters)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{filter.name}</span>
                  {canonical(filter.filters) === canonical(currentFilters) && (
                    <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground opacity-0 group-hover:opacity-100"
                  aria-label={`Delete saved filter ${filter.name}`}
                  onClick={() => deleteMutation.mutate(filter.id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
        <Separator className="my-2" />
        <div className="flex items-center gap-1">
          <Input
            className="h-8"
            placeholder="Save current filter as..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
          <Button
            size="lg"
            variant="secondary"
            disabled={!trimmed || createMutation.isPending || updateMutation.isPending}
            onClick={save}
          >
            {existing ? 'Overwrite' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
