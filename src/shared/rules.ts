import { z } from 'zod'

// ---------- conditions ----------
// A rule matches when every present condition matches (AND). Empty conditions
// are disallowed (a match-everything rule is a foot-gun), enforced by the
// refine on ruleConditionsSchema below.

export const ruleTextConditionSchema = z
  .object({
    op: z.enum(['contains', 'equals', 'regex']),
    value: z.string().trim().min(1).max(200)
  })
  // reject a regex that won't compile at author time rather than silently
  // never-matching it during a sync
  .refine(
    (c) => {
      if (c.op !== 'regex') return true
      try {
        new RegExp(c.value)
        return true
      } catch {
        return false
      }
    },
    { message: 'Invalid regular expression' }
  )

export const ruleAmountConditionSchema = z
  .object({
    op: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'between']),
    // absolute amount in integer milliunits (dollars * 1000); compared against
    // |transaction.amount| so the user never reasons about signs
    value: z.number().int().nonnegative(),
    value2: z.number().int().nonnegative().optional(),
    // optional sign filter: 'in' = money in (amount > 0), 'out' = money out
    // (amount < 0); omitted = either direction
    direction: z.enum(['in', 'out']).optional()
  })
  .refine((c) => c.op !== 'between' || (c.value2 !== undefined && c.value2 >= c.value), {
    message: 'A "between" amount needs a second value that is at least the first'
  })

export const ruleDateConditionSchema = z
  .object({
    // inclusive unix-seconds bounds on the transaction's effective date
    after: z.number().int().optional(),
    before: z.number().int().optional(),
    // inclusive day-of-month window (1-31), for recurring bills/rent
    dayOfMonthMin: z.number().int().min(1).max(31).optional(),
    dayOfMonthMax: z.number().int().min(1).max(31).optional()
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), {
    message: 'A date condition needs at least one bound'
  })

export const ruleConditionsSchema = z
  .object({
    description: ruleTextConditionSchema.optional(),
    amount: ruleAmountConditionSchema.optional(),
    accountId: z.number().int().positive().optional(),
    date: ruleDateConditionSchema.optional()
  })
  .refine(
    (c) =>
      c.description !== undefined ||
      c.amount !== undefined ||
      c.accountId !== undefined ||
      c.date !== undefined,
    { message: 'A rule needs at least one condition' }
  )

// ---------- action ----------
// One action per rule. Both write a user-owned field the sync upsert preserves,
// so applying a rule is safe and undoable (see action_log).

export const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setCategory'), categoryId: z.number().int().positive() }),
  z.object({ type: z.literal('markTransfer') })
])

export type RuleTextCondition = z.infer<typeof ruleTextConditionSchema>
export type RuleAmountCondition = z.infer<typeof ruleAmountConditionSchema>
export type RuleDateCondition = z.infer<typeof ruleDateConditionSchema>
export type RuleConditions = z.infer<typeof ruleConditionsSchema>
export type RuleAction = z.infer<typeof ruleActionSchema>

/** A rule as returned to the renderer (JSON columns already parsed). */
export interface Rule {
  id: number
  name: string
  enabled: boolean
  /** lower runs first; ties broken by id */
  priority: number
  conditions: RuleConditions
  action: RuleAction
}

// ---------- IPC inputs ----------

const ruleNameSchema = z.string().trim().min(1).max(80)

export const ruleCreateSchema = z.object({
  name: ruleNameSchema,
  conditions: ruleConditionsSchema,
  action: ruleActionSchema
})
export type RuleCreateInput = z.infer<typeof ruleCreateSchema>

export const ruleUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: ruleNameSchema.optional(),
  enabled: z.boolean().optional(),
  conditions: ruleConditionsSchema.optional(),
  action: ruleActionSchema.optional()
})
export type RuleUpdateInput = z.infer<typeof ruleUpdateSchema>

export const ruleReorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()).min(1)
})
export type RuleReorderInput = z.infer<typeof ruleReorderSchema>

// options for a manual preview/apply. overrideCategories lets setCategory rules
// overwrite a category the user already set, instead of only filling blanks;
// off on sync, opt-in from the "Apply rules now" dialog.
export const ruleApplyOptionsSchema = z.object({
  overrideCategories: z.boolean().default(false)
})
export type RuleApplyOptions = z.infer<typeof ruleApplyOptionsSchema>

// ---------- preview (dry-run) ----------

export interface RulePreviewTransaction {
  id: number
  description: string
  accountName: string
  /** integer milliunits */
  amount: number
  currency: string
  /** unix seconds */
  date: number
  /** target category name for setCategory groups; null for markTransfer */
  targetCategoryName: string | null
  /** the row's current category name, so an override shows what it replaces; null if uncategorized */
  currentCategoryName: string | null
}

export interface RulePreviewGroup {
  ruleId: number
  ruleName: string
  action: RuleAction
  transactions: RulePreviewTransaction[]
}

export type RulePreview = RulePreviewGroup[]

/** Summary of a manual apply, for the confirmation message. */
export interface RulesApplyResult {
  /** transactions that got a category */
  categorized: number
  /** transactions newly marked as transfers */
  markedTransfer: number
  /** rules that changed at least one row */
  rulesFired: number
}

export const RULES_IPC = {
  list: 'rules:list',
  create: 'rules:create',
  update: 'rules:update',
  delete: 'rules:delete',
  reorder: 'rules:reorder',
  // dry-run: compute what apply would do, without writing
  preview: 'rules:preview',
  // manual backfill over all untouched transactions
  apply: 'rules:apply'
} as const
