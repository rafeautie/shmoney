import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { clearData, seedDataset } from '@/lib/demo'
import { cn, ipcErrorMessage } from '@/lib/utils'

/** Pick a sample dataset and load it, or clear back to a fresh install. */
export function DatasetControls({ className }: { className?: string }): React.JSX.Element {
  const datasets = useQuery({
    queryKey: ['demo', 'datasets'],
    queryFn: () => window.api.demo.datasets(),
    staleTime: Infinity
  })
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = picked ?? datasets.data?.[0]?.id ?? null

  const run = async (action: () => Promise<void>, done: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      toast.success(done)
    } catch (e) {
      toast.error(ipcErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const name = datasets.data?.find((d) => d.id === selected)?.name

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select
        value={selected}
        onValueChange={(v) => setPicked(String(v))}
        items={Object.fromEntries((datasets.data ?? []).map((d) => [d.id, d.name]))}
      >
        <SelectTrigger className="w-40" aria-label="Sample dataset">
          <SelectValue placeholder="Dataset" />
        </SelectTrigger>
        <SelectContent>
          {datasets.data?.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        disabled={busy || !selected}
        onClick={() => selected && run(() => seedDataset(selected), `Loaded ${name} sample data`)}
      >
        Load
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => run(clearData, 'Cleared all data')}>
        Clear
      </Button>
    </div>
  )
}
