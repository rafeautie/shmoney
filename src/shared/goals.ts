import { z } from 'zod'
import { idSchema } from './ipc'
import { timeGrainSchema, type ResolvedQuery, type WidgetConfig } from './reports'

// Savings goals: a target amount backed by the user's own accounts. Progress is
// derived from transactions, never typed in, so a goal can't drift from the
// accounts it tracks.

/**
 * How a goal reads its progress. Fixed at creation: switching would mean
 * recomputing the baseline and reinterpreting history.
 *
 * - `balance`: the linked accounts' derived balances, exactly what Accounts shows.
 * - `contributions`: the signed sum of their transactions after `startedAt`.
 */
export type GoalMode = 'balance' | 'contributions'

export type GoalStatus = 'reached' | 'on-track' | 'behind' | 'overdue' | 'no-date'

// One vocabulary for every surface that shows a status: the goal card, the
// report widgets, and (later) the Budget page and chat. Nothing invents its own
// wording or its own red/green rule.
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

/** Everything computePace derives; all amounts are milliunits. */
export interface GoalPace {
  /** max(0, targetAmount − progress) */
  remaining: number
  status: GoalStatus
  /** the linear pace line evaluated at now; null without a target date */
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
  baselineAmount: number
  currency: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  accounts: { id: number; name: string }[]
  /** milliunits saved so far, per the goal's mode */
  progress: number
}

export interface GoalRemoveResult {
  /** action-log entry to replay for undo; null when there was nothing to remove */
  actionId: number | null
}

// ---------- inputs ----------

const goalNameSchema = z.string().trim().min(1).max(100)
const daySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)

export const goalCreateSchema = z.object({
  name: goalNameSchema,
  mode: z.enum(['balance', 'contributions']),
  /** milliunits */
  targetAmount: z.number().int().positive(),
  targetDate: daySchema.nullish(),
  /** unix seconds; defaults to now, never in the future */
  startedAt: z.number().int().positive().optional(),
  accountIds: z.array(idSchema).min(1)
})
export type GoalCreateInput = z.infer<typeof goalCreateSchema>

// `mode` is absent on purpose: it can't change after creation.
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

/** Saved at the end of each bucket, per goal. Shaped for the report widgets. */
export const goalSeriesQuerySchema = z.object({
  /** undefined = every active goal */
  goalIds: z.array(idSchema).optional(),
  timeGrain: timeGrainSchema,
  /** unix seconds, inclusive; null = unbounded */
  dateStart: z.number().int().nullable(),
  dateEnd: z.number().int().nullable()
})
export type GoalSeriesQuery = z.infer<typeof goalSeriesQuerySchema>

/**
 * The instant a start day begins, as the last second before its local midnight,
 * so every transaction dated on that day counts (imported and manual rows sit
 * at local noon, synced rows carry real timestamps) under the strictly-after
 * rule goals share with the account anchor.
 */
export function startInstantForDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000) - 1
}

/**
 * The goal-series query behind a report widget. Only the resolved date range
 * carries over from the filter bar: a goal defines its own accounts and its own
 * start instant, so narrowing it by categories or direction would produce a
 * number that isn't the goal's progress.
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
