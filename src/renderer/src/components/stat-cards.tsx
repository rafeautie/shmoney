import type { ReactNode } from 'react'
import { Amount } from '@/components/amount'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface Stat {
  label: string
  /** milliunits */
  value: number
  /** green/red by sign; only for the one number where the sign is the story */
  colored: boolean
  /** small line beneath the figure, e.g. what it is being measured against */
  sub?: ReactNode
}

// static class strings so Tailwind's scanner sees them
const COLUMNS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4'
}

/** A row of headline figures above a page's detail. Shared by Budget and Goals. */
export function StatCards({ stats, currency }: { stats: Stat[]; currency: string }) {
  return (
    <div className={cn('grid gap-4', COLUMNS[stats.length] ?? 'grid-cols-3')}>
      {stats.map((stat) => (
        <Card key={stat.label} className="py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold tracking-tight">
              <Amount value={stat.value} currency={currency} colored={stat.colored} />
            </p>
            {stat.sub !== undefined && <p className="text-xs text-muted-foreground">{stat.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
