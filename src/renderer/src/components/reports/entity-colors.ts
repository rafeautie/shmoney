import { useQuery } from '@tanstack/react-query'
import type { GroupBy, WidgetSource } from '@shared/reports'
import { NEUTRAL_COLOR, paletteColor } from '@/components/charts/chart-style'

export type EntityColor = (groupId: number | null) => string | undefined

/**
 * One color per category, group, account or goal, the same in every widget:
 * the entity's rank by id among all of its kind (archived goals included, so
 * archiving one never repaints the rest). Charts that colored by position
 * gave the same goal a different color in each widget. Rows without
 * an entity (Uncategorized) go neutral; ids the lists don't know yet fall back
 * to the chart's own order.
 */
export function useEntityColors(source: WidgetSource, groupBy: GroupBy): EntityColor | undefined {
  const kind = source === 'goals' ? 'goals' : groupBy
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list(),
    enabled: kind === 'category' || kind === 'categoryGroup'
  }).data
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list(),
    enabled: kind === 'account'
  }).data
  const goals = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list(),
    enabled: kind === 'goals'
  }).data

  let ids: number[] | undefined
  if (kind === 'category' && categories) {
    ids = [
      ...categories.groups.flatMap((g) => g.categories),
      ...categories.ungrouped,
      ...categories.system
    ].map((c) => c.id)
  } else if (kind === 'categoryGroup' && categories) {
    ids = categories.groups.map((g) => g.id)
  } else if (kind === 'account' && accounts) {
    ids = accounts.map((a) => a.id)
  } else if (kind === 'goals' && goals) {
    ids = goals.map((g) => g.id)
  }
  if (!ids) return undefined
  // rank by id: creation order, which no later edit reshuffles
  const rank = new Map([...ids].sort((a, b) => a - b).map((id, i) => [id, i]))
  return (groupId) => {
    if (groupId === null) return NEUTRAL_COLOR
    const i = rank.get(groupId)
    return i === undefined ? undefined : paletteColor(i)
  }
}

/** A total that stands for no single entity (Uncategorized, or an "Other"
 * rollup) is drawn neutral; anything else gets `colorOf`'s answer. */
export function totalColor(
  total: { groupId: number | null; groupIds: (number | null)[] },
  colorOf?: EntityColor
): string | undefined {
  if (total.groupIds.length > 1 || total.groupId === null) return NEUTRAL_COLOR
  return colorOf?.(total.groupId)
}
