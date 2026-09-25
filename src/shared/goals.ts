import { z } from 'zod'
import { idSchema } from './ipc'
import { timeGrainSchema, type ResolvedQuery, type WidgetConfig } from './reports'

/** Fixed at creation: switching would mean recomputing the baseline and reinterpreting history. */
export type GoalMode = 'balance' | 'contributions'

export type GoalStatus = 'reached' | 'on-track' | 'behind' | 'overdue' | 'no-date'

// one vocabulary for every surface that shows a status, so none invents its own
// wording or its own red/green rule
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  reached: 'Reached',
  'on-track': 'On track',
  behind: 'Behind',
  overdue: 'Overdue',
  'no-date': 'No target date'
}

export const GOAL_STATUS_TONE: Record<GoalStatus, 'accent' | 'destructive' | 'muted'> = {
  reached: 'accent',
  'on-track': 'accent',
  behind: 'destructive',
  overdue: 'destructive',
  'no-date': 'muted'
}

/** Milliunits throughout. */
export interface GoalPace {
  remaining: number
  status: GoalStatus
  /** the pace line at now; null without a target date */
  expectedByNow: number | null
  /** null when reached, overdue, or undated */
  neededPerMonth: number | null
  averagePerMonth: number
  /** 'YYYY-MM-DD'; null when the average isn't positive */
  projectedDate: string | null
}

export interface GoalSummary extends GoalPace {
  id: number
  name: string
  mode: GoalMode
  targetAmount: number
  /** 'YYYY-MM-DD' local date, compared in JS only; never used in SQL */
  targetDate: string | null
  /** unix seconds; transactions count strictly after it */
  startedAt: number
  /** where the pace line starts; never part of progress */
  baselineAmount: number
  currency: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  accounts: { id: number; name: string }[]
  progress: number
}

export interface GoalRemoveResult {
  /** action-log entry to replay for undo; null when there was nothing to remove */
  actionId: number | null
}

const goalNameSchema = z.string().trim().min(1).max(100)
const daySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)

export const goalCreateSchema = z.object({
  name: goalNameSchema,
  mode: z.enum(['balance', 'contributions']),
  targetAmount: z.number().int().positive(),
  targetDate: daySchema.nullish(),
  /** defaults to now, never in the future */
  startedAt: z.number().int().positive().optional(),
  accountIds: z.array(idSchema).min(1)
})
export type GoalCreateInput = z.infer<typeof goalCreateSchema>

// `mode` is absent on purpose: it can't change after creation
export const goalUpdateSchema = z.object({
  id: idSchema,
  name: goalNameSchema.optional(),
  targetAmount: z.number().int().positive().optional(),
  targetDate: daySchema.nullish(),
  startedAt: z.number().int().positive().optional(),
  accountIds: z.array(idSchema).min(1).optional(),
  archived: z.boolean().optional()
})
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>

export const goalRemoveSchema = z.object({ id: idSchema })
export type GoalRemoveInput = z.infer<typeof goalRemoveSchema>

export const goalSeriesQuerySchema = z.object({
  /** undefined = every active goal */
  goalIds: z.array(idSchema).optional(),
  timeGrain: timeGrainSchema,
  /** unix seconds, inclusive; null = unbounded */
  dateStart: z.number().int().nullable(),
  dateEnd: z.number().int().nullable()
})
export type GoalSeriesQuery = z.infer<typeof goalSeriesQuerySchema>

/** Just before a day's local midnight, so transactions dated that day count. */
export function startInstantForDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000) - 1
}

/**
 * Only the resolved date range carries over from the filter bar: a goal defines
 * its own accounts and start instant, so narrowing it by categories or direction
 * would produce a number that isn't its progress.
 */
export function resolveGoalQuery(config: WidgetConfig, resolved: ResolvedQuery): GoalSeriesQuery {
  return {
    goalIds: config.query.goalIds,
    timeGrain: resolved.timeGrain,
    dateStart: resolved.filters.dateStart,
    dateEnd: resolved.filters.dateEnd
  }
}

export const GOALS_IPC = {
  list: 'goals:list',
  create: 'goals:create',
  update: 'goals:update',
  remove: 'goals:remove',
  series: 'goals:series'
} as const
