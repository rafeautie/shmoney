import { HugeiconsIcon } from '@hugeicons/react'
import { GridViewIcon, ListViewIcon } from '@hugeicons/core-free-icons'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type ListView = 'cards' | 'table'

/** Cards or rows, for a page that lists the same records both ways. */
export function ViewToggle({
  view,
  onChange
}: {
  view: ListView
  onChange: (view: ListView) => void
}) {
  return (
    <Tabs value={view} onValueChange={(next) => onChange(next as ListView)}>
      <TabsList className="h-7">
        <TabsTrigger value="cards" className="text-xs" aria-label="Card view">
          <HugeiconsIcon icon={GridViewIcon} className="size-3.5" />
          Cards
        </TabsTrigger>
        <TabsTrigger value="table" className="text-xs" aria-label="Table view">
          <HugeiconsIcon icon={ListViewIcon} className="size-3.5" />
          Table
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
