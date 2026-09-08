import { Amount } from '@/components/amount'
import { Card, CardContent } from '@/components/ui/card'

export interface Stat {
  label: string
  /** milliunits */
  value: number
  /** green/red by sign; only for the one number where the sign is the story */
  colored: boolean
}

/** A row of headline figures above a page's detail. Shared by Budget and Goals. */
export function StatCards({ stats, currency }: { stats: Stat[]; currency: string }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold tracking-tight">
              <Amount value={stat.value} currency={currency} colored={stat.colored} />
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
