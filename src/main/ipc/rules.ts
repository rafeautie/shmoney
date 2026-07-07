import { ipcMain } from 'electron'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { accounts, categories, rules, transactions } from '../db/schema'
import type { RuleRow } from '../db/schema'
import { recordAction } from './action-log'
import { transactionDate } from './transactions-page'
import { evaluateRules, type RuleCandidate } from '../rules'
import {
  idSchema,
  type ActionChange
} from '@shared/ipc'
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

// parse a stored row into a Rule; drop it (rather than crash) if its JSON no
// longer matches the schema — mirrors saved-filters' defensive listing
function toRule(row: RuleRow): Rule | null {
  const conditions = ruleConditionsSchema.safeParse(row.conditions)
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

// rules that are safe to run now: drops setCategory rules whose target category
// was deleted (applying one would violate the FK and abort the whole sync)
function loadApplicableRules(tx: Tx): Rule[] {
  const all = loadRules(tx)
  const wanted = [
    ...new Set(all.flatMap((r) => (r.action.type === 'setCategory' ? [r.action.categoryId] : [])))
  ]
  if (wanted.length === 0) return all
  const existing = new Set(
    tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, wanted)).all().map((c) => c.id)
  )
  return all.filter((r) => {
    if (r.action.type !== 'setCategory' || existing.has(r.action.categoryId)) return true
    console.warn(`rule ${r.id} ("${r.name}") targets a deleted category, skipping`)
    return false
  })
}

// untouched, actionable rows: pending rows are excluded everywhere (sync drops
// and re-inserts them) and soft-deleted rows are invisible
function selectCandidates(tx: Tx): RuleCandidate[] {
  return tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amount: transactions.amount,
      description: transactions.description,
      date: transactionDate,
      categoryId: transactions.categoryId,
      isTransfer: transactions.isTransfer
    })
    .from(transactions)
    .where(and(eq(transactions.pending, false), isNull(transactions.deletedAt)))
    .all()
}

/**
 * Run every applicable rule over the untouched rows, write the changes, and log
 * one action_log entry per rule that fired (source 'rule') so each is reviewable
 * and undoable. Shared by the sync handler (fill-empty) and the manual "Apply
 * rules now", which may pass overrideCategories to overwrite existing categories.
 */
export function applyRulesInTx(tx: Tx, overrideCategories = false): RulesApplyResult {
  const candidates = selectCandidates(tx)
  const firings = evaluateRules(loadApplicableRules(tx), candidates, overrideCategories)
  const priorCategory = new Map(candidates.map((c) => [c.id, c.categoryId]))
  let categorized = 0
  let markedTransfer = 0
  let rulesFired = 0
  for (const { rule, ids } of firings) {
    if (rule.action.type === 'setCategory') {
      const categoryId = rule.action.categoryId
      // under override a firing can include rows already at the target; skip
      // those so we don't write or log a before===after no-op
      const changedIds = ids.filter((id) => (priorCategory.get(id) ?? null) !== categoryId)
      if (changedIds.length === 0) continue
      tx.update(transactions).set({ categoryId }).where(inArray(transactions.id, changedIds)).run()
      recordAction(tx, {
        source: 'rule',
        label: `Rule "${rule.name}" categorized ${plural(changedIds.length, 'transaction')}`,
        changes: changedIds.map(
          (id): ActionChange => ({
            transactionId: id,
            field: 'categoryId',
            before: priorCategory.get(id) ?? null,
            after: categoryId
          })
        )
      })
      categorized += changedIds.length
      rulesFired++
    } else {
      tx.update(transactions).set({ isTransfer: true }).where(inArray(transactions.id, ids)).run()
      recordAction(tx, {
        source: 'rule',
        label: `Rule "${rule.name}" marked ${plural(ids.length, 'transaction')} as transfer`,
        changes: ids.map(
          (id): ActionChange => ({ transactionId: id, field: 'isTransfer', before: false, after: true })
        )
      })
      markedTransfer += ids.length
      rulesFired++
    }
  }
  return { categorized, markedTransfer, rulesFired }
}

// dry-run: the same evaluation, but instead of writing, enrich each affected row
// with its display context and group by the rule that would touch it
function previewRules(tx: Tx, overrideCategories = false): RulePreview {
  const candidates = selectCandidates(tx)
  const firings = evaluateRules(loadApplicableRules(tx), candidates, overrideCategories)
  const priorCategory = new Map(candidates.map((c) => [c.id, c.categoryId]))
  const touched = [...new Set(firings.flatMap((f) => f.ids))]
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
  const categoryName = new Map(tx.select().from(categories).all().map((c) => [c.id, c.name]))

  return firings.flatMap((f) => {
    const targetCategoryId = f.rule.action.type === 'setCategory' ? f.rule.action.categoryId : null
    const targetCategoryName = targetCategoryId !== null ? categoryName.get(targetCategoryId) ?? null : null
    const txns: RulePreviewTransaction[] = f.ids.flatMap((id) => {
      const c = context.get(id)
      if (!c) return []
      const current = priorCategory.get(id) ?? null
      // drop no-op rows already at the target (only reachable under override)
      if (targetCategoryId !== null && current === targetCategoryId) return []
      const currentCategoryName = current !== null ? categoryName.get(current) ?? null : null
      return [{ ...c, targetCategoryName, currentCategoryName }]
    })
    // a group whose rows were all no-ops has nothing to preview
    if (txns.length === 0) return []
    return [{ ruleId: f.rule.id, ruleName: f.rule.name, action: f.rule.action, transactions: txns }]
  })
}

export function registerRulesIpc(): void {
  ipcMain.handle(RULES_IPC.list, (): Rule[] => db.transaction((tx) => loadRules(tx)))

  ipcMain.handle(RULES_IPC.create, (_event, input: unknown): Rule => {
    const { name, conditions, action } = ruleCreateSchema.parse(input)
    const now = nowSec()
    return db.transaction((tx) => {
      const next =
        tx.select({ v: sql<number>`coalesce(max(${rules.priority}), -1)` }).from(rules).get()?.v ?? -1
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
    return db.transaction((tx) => applyRulesInTx(tx, overrideCategories))
  })
}
