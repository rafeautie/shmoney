import type { ReactNode } from 'react'
import type { EnvelopeSection } from '@shared/budgets'
import { Amount } from '@/components/amount'

/** A card-view group heading: the group name, then its budgeted, spent and available. */
export function SectionHeader({
  section,
  currency
}: {
  section: EnvelopeSection
  currency: string
}) {
  const { fill, spent, balance } = section.totals
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b pb-2">
      <h3 className="text-sm font-semibold tracking-tight">{section.groupName ?? 'Ungrouped'}</h3>
      <dl className="flex items-baseline gap-4 text-xs text-muted-foreground">
        <SectionFigure label="Budgeted">
          <Amount value={fill} currency={currency} colored={false} />
        </SectionFigure>
        <SectionFigure label="Spent">
          <Amount value={spent} currency={currency} colored={false} />
        </SectionFigure>
        <SectionFigure label="Available">
          <Amount value={balance} currency={currency} colored />
        </SectionFigure>
      </dl>
    </div>
  )
}

function SectionFigure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  )
}
