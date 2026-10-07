import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { db } from '.'
import { budgets, categories, categoryGroups, ruleSuggestions, rules, transactions } from './schema'
import type { RuleConditions, RuleAction } from '@shared/rules'
import type { CategoryDeleteSnapshot, RuleSnapshot } from '@shared/ipc'

// Category, group and rule deletes are hard deletes whose FK cascades reach
// budgets, suggestions and transaction assignments. These capture everything a
// delete takes, so undo can put it back with the same ids, and redo can repeat
// it. All run inside the caller's transaction.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const IN_CHUNK = 10_000

function inChunks<T>(items: T[], fn: (chunk: T[]) => void): void {
  for (let i = 0; i < items.length; i += IN_CHUNK) fn(items.slice(i, i + IN_CHUNK))
}

function ruleTarget(action: unknown): unknown {
  return (action as { categoryId?: unknown }).categoryId
}

/** Snapshot a whole group (groupId) or a single category (categoryId). */
export function snapshotCategories(
  tx: Tx,
  target: { groupId: number } | { categoryId: number }
): CategoryDeleteSnapshot | null {
  let group: CategoryDeleteSnapshot['group'] = null
  let cats: CategoryDeleteSnapshot['categories']
  if ('groupId' in target) {
    const row = tx.select().from(categoryGroups).where(eq(categoryGroups.id, target.groupId)).get()
    if (!row) return null
    group = { id: row.id, name: row.name }
    cats = tx
      .select({ id: categories.id, groupId: categories.groupId, name: categories.name })
      .from(categories)
      .where(eq(categories.groupId, row.id))
      .all()
  } else {
    cats = tx
      .select({ id: categories.id, groupId: categories.groupId, name: categories.name })
      .from(categories)
      .where(eq(categories.id, target.categoryId))
      .all()
    if (cats.length === 0) return null
  }
  const ids = cats.map((c) => c.id)
  const assigned = ids.length
    ? tx
        .select({ id: transactions.id, categoryId: transactions.categoryId })
        .from(transactions)
        .where(inArray(transactions.categoryId, ids))
        .all()
    : []
  const assignments = ids
    .map((categoryId) => ({
      categoryId,
      transactionIds: assigned.filter((t) => t.categoryId === categoryId).map((t) => t.id)
    }))
    .filter((a) => a.transactionIds.length > 0)
  const idSet = new Set(ids)
  return {
    group,
    categories: cats,
    assignments,
    budgets: ids.length
      ? tx
          .select({ categoryId: budgets.categoryId, month: budgets.month, amount: budgets.amount })
          .from(budgets)
          .where(inArray(budgets.categoryId, ids))
          .all()
      : [],
    suggestions: ids.length
      ? tx.select().from(ruleSuggestions).where(inArray(ruleSuggestions.categoryId, ids)).all()
      : [],
    rules: tx
      .select()
      .from(rules)
      .all()
      .filter((r) => idSet.has(ruleTarget(r.action) as number))
  }
}

/** Delete what a snapshot covers. Cascades clear budgets and suggestions and
 *  uncategorize transactions; rules have no FK, so they go explicitly. */
export function deleteCategorySnapshot(tx: Tx, snapshot: CategoryDeleteSnapshot): number {
  let changed = 0
  if (snapshot.group) {
    changed += tx
      .delete(categoryGroups)
      .where(eq(categoryGroups.id, snapshot.group.id))
      .run().changes
  } else {
    const ids = snapshot.categories.map((c) => c.id)
    if (ids.length)
      changed += tx.delete(categories).where(inArray(categories.id, ids)).run().changes
  }
  const ruleIds = snapshot.rules.map((r) => r.id)
  if (ruleIds.length) tx.delete(rules).where(inArray(rules.id, ruleIds)).run()
  return changed
}

/**
 * Redo of a category or group delete. Compare-and-set like every other redo:
 * it goes ahead only while everything the delete would take was there when the
 * snapshot was made, so a rename, a new fill, a rule edit or a transaction
 * filed under it since the undo keeps the whole thing (returns 0).
 */
export function redeleteCategorySnapshot(tx: Tx, snapshot: CategoryDeleteSnapshot): number {
  const target = snapshot.group
    ? { groupId: snapshot.group.id }
    : snapshot.categories[0] && { categoryId: snapshot.categories[0].id }
  const current = target ? snapshotCategories(tx, target) : null
  if (!current || current.group?.name !== snapshot.group?.name) return 0
  const same =
    allKnown(JSON.stringify, snapshot.categories, current.categories) &&
    allKnown(JSON.stringify, snapshot.budgets, current.budgets) &&
    allKnown(ruleContent, snapshot.rules, current.rules) &&
    allKnown(String, assignmentPairs(snapshot), assignmentPairs(current))
  return same ? deleteCategorySnapshot(tx, snapshot) : 0
}

function allKnown<T>(key: (item: T) => string, before: T[], now: T[]): boolean {
  const known = new Set(before.map(key))
  return now.every((item) => known.has(key(item)))
}

function assignmentPairs(snapshot: CategoryDeleteSnapshot): string[] {
  return snapshot.assignments.flatMap(({ categoryId, transactionIds }) =>
    transactionIds.map((id) => `${categoryId}:${id}`)
  )
}

/**
 * Put a deleted group/category back with its original ids. Skipped (returns 0)
 * when something has taken its place since: a group or category of the same
 * name, or the parent group of a lone category is gone. Transactions are only
 * re-assigned while still uncategorized, so later edits win.
 */
export function restoreCategorySnapshot(tx: Tx, snapshot: CategoryDeleteSnapshot): number {
  if (snapshot.group) {
    const { id, name } = snapshot.group
    const clash = tx
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(eq(categoryGroups.name, name))
      .get()
    if (clash) return 0
    tx.insert(categoryGroups).values({ id, name }).onConflictDoNothing().run()
  }
  let changed = 0
  for (const cat of snapshot.categories) {
    if (cat.groupId !== null) {
      const parent = tx
        .select({ id: categoryGroups.id })
        .from(categoryGroups)
        .where(eq(categoryGroups.id, cat.groupId))
        .get()
      if (!parent) continue
    }
    const nameTaken = tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          cat.groupId === null ? isNull(categories.groupId) : eq(categories.groupId, cat.groupId),
          eq(categories.name, cat.name)
        )
      )
      .get()
    if (nameTaken) continue
    changed += tx.insert(categories).values(cat).onConflictDoNothing().run().changes
  }
  const restored = new Set(
    snapshot.categories.length
      ? tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            inArray(
              categories.id,
              snapshot.categories.map((c) => c.id)
            )
          )
          .all()
          .map((c) => c.id)
      : []
  )
  for (const { categoryId, transactionIds } of snapshot.assignments) {
    if (!restored.has(categoryId)) continue
    inChunks(transactionIds, (ids) => {
      tx.update(transactions)
        .set({ categoryId })
        .where(and(inArray(transactions.id, ids), isNull(transactions.categoryId)))
        .run()
    })
  }
  const fills = snapshot.budgets.filter((b) => restored.has(b.categoryId))
  if (fills.length) tx.insert(budgets).values(fills).onConflictDoNothing().run()
  const suggestions = snapshot.suggestions.filter((s) => restored.has(s.categoryId))
  if (suggestions.length) tx.insert(ruleSuggestions).values(suggestions).onConflictDoNothing().run()
  for (const rule of snapshot.rules) {
    if (restored.has(ruleTarget(rule.action) as number)) restoreRuleSnapshot(tx, rule)
  }
  return changed
}

export function snapshotRule(tx: Tx, id: number): RuleSnapshot | null {
  return tx.select().from(rules).where(eq(rules.id, id)).get() ?? null
}

// what a rule does, to tell an edit from a renumbering (reorders move priority)
function ruleContent(rule: RuleSnapshot): string {
  return JSON.stringify([rule.name, rule.enabled, rule.conditions, rule.action])
}

/** Redo of a rule delete, skipped (0) when the rule was edited since the undo. */
export function redeleteRule(tx: Tx, snapshot: RuleSnapshot): number {
  const current = snapshotRule(tx, snapshot.id)
  if (!current || ruleContent(current) !== ruleContent(snapshot)) return 0
  return tx.delete(rules).where(eq(rules.id, snapshot.id)).run().changes
}

/** Reinsert a deleted rule with its id and priority, unless its target category is gone. */
export function restoreRuleSnapshot(tx: Tx, rule: RuleSnapshot): number {
  const target = ruleTarget(rule.action)
  if (typeof target === 'number') {
    const exists = tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, target))
      .get()
    if (!exists) return 0
  }
  return tx
    .insert(rules)
    .values({
      ...rule,
      conditions: rule.conditions as RuleConditions,
      action: rule.action as RuleAction
    })
    .onConflictDoNothing()
    .run().changes
}
