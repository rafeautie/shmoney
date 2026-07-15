import { ipcMain } from 'electron'
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { accounts, categories, rules, transactions } from '../db/schema'
import { notTransferSql } from '../db/system-categories'
import type { RuleRow } from '../db/schema'
import { recordAction } from './action-log'
import { transactionDate } from './transactions-page'
import { compileConditions } from '../rules'
import { idSchema, type ActionChange } from '@shared/ipc'
import {
  RULES_IPC,
  ruleActionSchema,
  ruleApplyOptionsSchema,
  ruleConditionsSchema,
  ruleCreateSchema,
  ruleReorderSchema,
  ruleUpdateSchema,
  type Rule,
  type RulePreview,
  type RulePreviewTransaction,
  type RulesApplyResult
} from '@shared/rules'

// the drizzle transaction handle passed to db.transaction() callbacks
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

// upgrade a stored condition blob from the pre-multi-phrase shape: a description
// text condition held a single `value`; it now holds a `phrases` array. A legacy
// regex op is intentionally left un-normalized so it fails the schema and the
// rule is dropped (a regex can't be re-expressed as a literal phrase).
function normalizeConditions(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const c = raw as Record<string, unknown>
  const d = c.description
  if (d && typeof d === 'object' && 'value' in d && !('phrases' in d)) {
    const legacy = d as { op?: unknown; value?: unknown }
    if (legacy.op === 'contains' || legacy.op === 'equals') {
      return { ...c, description: { op: legacy.op, phrases: [legacy.value] } }
    }
  }
  return raw
}

// parse a stored row into a Rule; drop it (rather than crash) if its JSON no
// longer matches the schema — mirrors saved-filters' defensive listing
function toRule(row: RuleRow): Rule | null {
  const conditions = ruleConditionsSchema.safeParse(normalizeConditions(row.conditions))
  const action = ruleActionSchema.safeParse(row.action)
  if (!conditions.success || !action.success) {
    console.warn(`rule ${row.id} ("${row.name}") failed to parse, skipping`)
    return null
  }
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    conditions: conditions.data,
    action: action.data
  }
}

function loadRules(tx: Tx): Rule[] {
  return tx
    .select()
    .from(rules)
    .orderBy(asc(rules.priority), asc(rules.id))
    .all()
    .flatMap((row) => {
      const rule = toRule(row)
      return rule ? [rule] : []
    })
}

// rules that are safe to run now: drops rules whose target category was
// deleted (applying one would violate the FK and abort the whole sync)
function loadApplicableRules(tx: Tx): Rule[] {
  const all = loadRules(tx)
  const wanted = [...new Set(all.map((r) => r.action.categoryId))]
  if (wanted.length === 0) return all
  const existing = new Set(
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, wanted))
      .all()
      .map((c) => c.id)
  )
  return all.filter((r) => {
    if (existing.has(r.action.categoryId)) return true
    console.warn(`rule ${r.id} ("${r.name}") targets a deleted category, skipping`)
    return false
  })
}

// enabled, applicable rules in priority order — used by the suggestion detector
// to skip descriptions an existing rule already handles
export function loadEnabledRules(): Rule[] {
  return db.transaction((tx) => loadApplicableRules(tx).filter((r) => r.enabled))
}

// Narrows which rows a run considers: an explicit id list or a single account.
// Omitted (or empty) means every untouched row, the sync/manual-apply default.
export interface RuleApplyScope {
  transactionIds?: number[]
  accountId?: number
}

// rows a run may touch: within scope, not pending (sync drops and re-inserts
// them, so any change would be lost) and not soft-deleted
function baseFilter(scope?: RuleApplyScope): SQL {
  const scopeFilter = scope?.transactionIds
    ? inArray(transactions.id, scope.transactionIds)
    : scope?.accountId !== undefined
      ? eq(transactions.accountId, scope.accountId)
      : undefined
  return and(scopeFilter, eq(transactions.pending, false), isNull(transactions.deletedAt))!
}

// which matched rows a rule may claim: only blank categories unless overriding,
// and even an override never touches a row filed under Transfers — silently
// turning a transfer into income/expense would corrupt reports
function eligibility(overrideCategories: boolean): SQL {
  return overrideCategories ? notTransferSql() : isNull(transactions.categoryId)
}

/**
 * Run every applicable rule over the untouched rows, write the changes, and log
 * one action_log entry per rule that fired (source 'rule') so each is reviewable
 * and undoable. Shared by the sync handler and the manual "Apply rules now"
 * (both unscoped; manual apply may pass overrideCategories to overwrite an
 * existing category) and auto-categorize, which scopes the run to its selection.
 */
export function applyRulesInTx(
  tx: Tx,
  {
    overrideCategories = false,
    scope
  }: { overrideCategories?: boolean; scope?: RuleApplyScope } = {}
): RulesApplyResult {
  const base = baseFilter(scope)
  const claimed = new Set<number>()
  let categorized = 0
  let rulesFired = 0

  for (const rule of loadApplicableRules(tx)) {
    // matching runs in SQL; the first rule to claim a row owns it, so later
    // rules skip anything already claimed
    const matched = tx
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(base, eligibility(overrideCategories), compileConditions(rule.conditions)))
      .all()
      .filter((r) => !claimed.has(r.id))
    if (matched.length === 0) continue
    for (const r of matched) claimed.add(r.id)

    const categoryId = rule.action.categoryId
    // under override a match can include rows already at the target; skip
    // those so we don't write or log a before===after no-op
    const changed = matched.filter((r) => (r.categoryId ?? null) !== categoryId)
    if (changed.length === 0) continue
    const ids = changed.map((r) => r.id)
    tx.update(transactions).set({ categoryId }).where(inArray(transactions.id, ids)).run()
    recordAction(tx, {
      source: 'rule',
      label: `Rule "${rule.name}" categorized ${plural(ids.length, 'transaction')}`,
      changes: changed.map((r): ActionChange => ({
        transactionId: r.id,
        field: 'categoryId',
        before: r.categoryId ?? null,
        after: categoryId
      }))
    })
    categorized += ids.length
    rulesFired++
  }
  return { categorized, rulesFired }
}

// dry-run: the same matching, but instead of writing, enrich each affected row
// with its display context and group by the rule that would touch it
function previewRules(tx: Tx, overrideCategories = false): RulePreview {
  const base = baseFilter() // preview always considers every untouched row
  const claimed = new Set<number>()
  // per rule, the rows it would change (after no-op filtering), in priority order
  const groups: { rule: Rule; rows: { id: number; categoryId: number | null }[] }[] = []
  for (const rule of loadApplicableRules(tx)) {
    const matched = tx
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(base, eligibility(overrideCategories), compileConditions(rule.conditions)))
      .all()
      .filter((r) => !claimed.has(r.id))
    if (matched.length === 0) continue
    for (const r of matched) claimed.add(r.id)
    // drop no-op rows already at the target (only reachable under override)
    const rows = matched.filter((r) => (r.categoryId ?? null) !== rule.action.categoryId)
    if (rows.length > 0) groups.push({ rule, rows })
  }

  const touched = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.id)))]
  if (touched.length === 0) return []

  const context = new Map(
    tx
      .select({
        id: transactions.id,
        description: transactions.description,
        accountName: accounts.name,
        amount: transactions.amount,
        currency: accounts.currency,
        date: transactionDate
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(inArray(transactions.id, touched))
      .all()
      .map((r) => [r.id, r])
  )
  const categoryName = new Map(
    tx
      .select()
      .from(categories)
      .all()
      .map((c) => [c.id, c.name])
  )

  return groups.flatMap((g) => {
    const targetCategoryName = categoryName.get(g.rule.action.categoryId) ?? null
    const txns: RulePreviewTransaction[] = g.rows.flatMap((r) => {
      const c = context.get(r.id)
      if (!c) return []
      const currentCategoryName =
        r.categoryId !== null ? (categoryName.get(r.categoryId) ?? null) : null
      return [{ ...c, targetCategoryName, currentCategoryName }]
    })
    if (txns.length === 0) return []
    return [{ ruleId: g.rule.id, ruleName: g.rule.name, action: g.rule.action, transactions: txns }]
  })
}

export function registerRulesIpc(): void {
  ipcMain.handle(RULES_IPC.list, (): Rule[] => db.transaction((tx) => loadRules(tx)))

  ipcMain.handle(RULES_IPC.create, (_event, input: unknown): Rule => {
    const { name, conditions, action } = ruleCreateSchema.parse(input)
    const now = nowSec()
    return db.transaction((tx) => {
      const next =
        tx
          .select({ v: sql<number>`coalesce(max(${rules.priority}), -1)` })
          .from(rules)
          .get()?.v ?? -1
      const row = tx
        .insert(rules)
        .values({ name, conditions, action, priority: next + 1, createdAt: now, updatedAt: now })
        .returning()
        .get()
      const rule = toRule(row)
      if (!rule) throw new Error('Failed to create rule')
      return rule
    })
  })

  ipcMain.handle(RULES_IPC.update, (_event, input: unknown): Rule => {
    const { id, name, enabled, conditions, action } = ruleUpdateSchema.parse(input)
    const row = db
      .update(rules)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(conditions !== undefined ? { conditions } : {}),
        ...(action !== undefined ? { action } : {}),
        updatedAt: nowSec()
      })
      .where(eq(rules.id, id))
      .returning()
      .get()
    if (!row) throw new Error(`Rule ${id} not found`)
    const rule = toRule(row)
    if (!rule) throw new Error(`Rule ${id} is corrupt`)
    return rule
  })

  ipcMain.handle(RULES_IPC.delete, (_event, input: unknown): boolean => {
    const id = idSchema.parse(input)
    db.delete(rules).where(eq(rules.id, id)).run()
    return true
  })

  ipcMain.handle(RULES_IPC.reorder, (_event, input: unknown): boolean => {
    const { orderedIds } = ruleReorderSchema.parse(input)
    db.transaction((tx) => {
      orderedIds.forEach((id, index) => {
        tx.update(rules).set({ priority: index, updatedAt: nowSec() }).where(eq(rules.id, id)).run()
      })
    })
    return true
  })

  ipcMain.handle(RULES_IPC.preview, (_event, input: unknown): RulePreview => {
    const { overrideCategories } = ruleApplyOptionsSchema.parse(input ?? {})
    return db.transaction((tx) => previewRules(tx, overrideCategories))
  })

  ipcMain.handle(RULES_IPC.apply, (_event, input: unknown): RulesApplyResult => {
    const { overrideCategories } = ruleApplyOptionsSchema.parse(input ?? {})
    return db.transaction((tx) => applyRulesInTx(tx, { overrideCategories }))
  })
}
