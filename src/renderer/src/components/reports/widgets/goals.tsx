import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts'
import type { WidgetConfig } from '@shared/reports'
import { GOAL_STATUS_LABELS, GOAL_STATUS_TONE, type GoalSummary } from '@shared/goals'
import { GoalProgressRow } from '@/components/goals/goal-progress'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { paletteColor } from '@/components/charts/chart-style'
import { WidgetError } from '../widget-error'
import { useEntityColors } from '../entity-colors'
import { TooltipRow, WidgetSkeleton } from './shared'

/** Shares the Goals page's ['goals'] key, so a card and a widget open side by
 * side can never disagree. */
export function GoalsWidget({ config }: { config: WidgetConfig }) {
  const query = useQuery({
    meta: { silenceError: true },
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list(),
    placeholderData: (prev: GoalSummary[] | undefined) => prev
  })

  if (query.isLoading) return <WidgetSkeleton />
  if (query.isError) {
    return <WidgetError error={query.error} onRetry={() => void query.refetch()} />
  }
  const goals = query.data!.filter((goal) => goal.archivedAt === null)
  if (goals.length === 0) return <NoGoalsNote />

  const view = config.display?.goalView ?? 'list'
  return view === 'list' ? (
    <ScrollArea className="h-full">
      <div className="space-y-3 px-4 pb-4">
        {goals.map((goal) => (
          <GoalProgressRow key={goal.id} goal={goal} />
        ))}
      </div>
    </ScrollArea>
  ) : (
    <GoalBarsChart goals={goals} />
  )
}

/** Saved as a share of target, one bar per goal in the goal's own color (the
 * one its line has in "Saved over time"). A goal that needs attention says so
 * in words at the end of its bar, so color never has to mean two things. */
function GoalBarsChart({ goals }: { goals: GoalSummary[] }) {
  const colorOf = useEntityColors('goals', 'none')
  const data = goals.map((goal, i) => ({
    label: goal.name,
    pct:
      goal.targetAmount > 0
        ? Math.min(100, Math.max(0, (goal.progress / goal.targetAmount) * 100))
        : 0,
    progress: goal.progress,
    target: goal.targetAmount,
    currency: goal.currency,
    fill: colorOf?.(goal.id) ?? paletteColor(i),
    status: GOAL_STATUS_TONE[goal.status] === 'destructive' ? GOAL_STATUS_LABELS[goal.status] : ''
  }))
  return (
    <div className="h-full px-4 pb-4">
      <ChartContainer config={{ pct: { label: 'Saved' } }} className="aspect-auto h-full w-full">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 64 }} barCategoryGap="30%">
          {/* the gridded 0-100% scale is what "against target" reads off, and it
              stays legible for a goal with nothing saved and so no bar */}
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={96}
            tickMargin={4}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(_value, _name, item) => (
                  <TooltipRow
                    label={item.payload?.label}
                    measure="income"
                    value={item.payload?.progress ?? 0}
                    currency={item.payload?.currency}
                  />
                )}
              />
            }
          />
          <Bar dataKey="pct" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.fill} />
            ))}
            <LabelList
              dataKey="status"
              position="right"
              offset={8}
              className="fill-destructive text-footnote font-medium"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

export function NoGoalsNote() {
  return (
    <Empty className="h-full p-4">
      <EmptyDescription className="text-sm">No savings goals yet.</EmptyDescription>
    </Empty>
  )
}
