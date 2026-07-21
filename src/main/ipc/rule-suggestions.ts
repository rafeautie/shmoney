import { ipcMain } from 'electron'
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { categories, ruleSuggestions, settings, transactions } from '../db/schema'
import { notTransferSql } from '../db/system-categories'
import { compileConditions } from '../rules'
import { loadEnabledRules } from './rules'
import { extractRuleTerm } from '../llm/features/extract-rule-term'
import { sendToRenderer } from '../llm/manager'
import { idSchema } from '@shared/ipc'
import {
  RULE_SUGGESTIONS_CREATED,
  RULE_SUGGESTIONS_IPC,
  type RuleSuggestion
} from '@shared/rule-suggestions'

// how many identical transactions make a pattern worth suggesting a rule for
const MIN_IDENTICAL = 3

function suggestionsEnabled(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, 'ruleSuggestionsEnabled')).get()
  // default on; only an explicit stored `false` disables it
  return row ? row.value !== false : true
}

// the SQL predicate for the transactions a suggestion's would-be rule matches
// (the same `contains` compilation the real rule would get, so counts and
// coverage are honest)
function matchPredicate(phrase: string): SQL {
  return compileConditions({ description: { op: 'contains', phrases: [phrase] } })
}

// how many current transactions the suggestion's rule would reach. Ignores
// category so a partly-categorized cluster still counts.
function countMatching(phrase: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(
          matchPredicate(phrase),
          isNull(transactions.deletedAt),
          eq(transactions.pending, false),
          notTransferSql()
        )
      )
      .get()?.n ?? 0
  )
}

// is the suggestion's target already categorized to this category by an
// existing enabled rule? Reuses the engine: a rule covers it if its compiled
// conditions match at least one transaction the suggestion would match.
function alreadyCovered(
  phrase: string,
  categoryId: number,
  rules: ReturnType<typeof loadEnabledRules>
): boolean {
  return rules.some((rule) => {
    if (rule.action.type !== 'setCategory' || rule.action.categoryId !== categoryId) return false
    const hit = db
      .select({ one: sql`1` })
      .from(transactions)
      .where(and(matchPredicate(phrase), compileConditions(rule.conditions)))
      .limit(1)
      .get()
    return hit !== undefined
  })
}

/**
 * After a batch of category writes, look for descriptions the user (or the LLM)
 * has now categorized the same way across enough transactions and record a rule
 * suggestion for each. When the local model is available it narrows the exact
 * description to a reusable merchant term (a `contains` suggestion); otherwise
 * the suggestion falls back to the exact description, exactly the old
 * behavior. A pair is suppressed only while it's active — already pending, or
 * covered by an enabled rule; a dismissed or orphaned-accepted pair earns a
 * fresh suggestion by being categorized again. Fires a renderer event when it
 * creates any, so the notification center and settings list refresh.
 */
export async function detectRuleSuggestions(
  changed: { transactionId: number; categoryId: number }[],
  source: 'user' | 'llm'
): Promise<void> {
  if (!suggestionsEnabled() || changed.length === 0) return

  const descById = new Map(
    db
      .select({ id: transactions.id, description: transactions.description })
      .from(transactions)
      .where(
        inArray(
          transactions.id,
          changed.map((c) => c.transactionId)
        )
      )
      .all()
      .map((r) => [r.id, r.description])
  )

  // distinct (description, category) pairs among the just-changed rows
  const pairs = new Map<string, { description: string; categoryId: number }>()
  for (const c of changed) {
    const description = descById.get(c.transactionId)
    if (description === undefined) continue
    pairs.set(JSON.stringify([c.categoryId, description]), {
      description,
      categoryId: c.categoryId
    })
  }

  const rules = loadEnabledRules()
  let created = 0
  for (const { description, categoryId } of pairs.values()) {
    const count = countMatching(description)
    if (count < MIN_IDENTICAL) continue
    if (alreadyCovered(description, categoryId, rules)) continue

    const now = Date.now()
    // this exact cluster was suggested before: reactivate or skip without
    // spending a generation — the cluster keeps the phrase it was given
    const byKey = db
      .select()
      .from(ruleSuggestions)
      .where(
        and(
          eq(ruleSuggestions.descriptionKey, description),
          eq(ruleSuggestions.categoryId, categoryId)
        )
      )
      .get()
    if (byKey) {
      // pending = already suggested, don't double up. Anything else (dismissed,
      // or accepted with the covering rule gone) reactivates as a fresh suggestion
      if (byKey.status === 'pending') continue
      db.update(ruleSuggestions)
        .set({ status: 'pending', matchCount: count, source, createdAt: now, updatedAt: now })
        .where(eq(ruleSuggestions.id, byKey.id))
        .run()
      created++
      continue
    }

    // the model narrows the description to a reusable term, taken as-is; when
    // it isn't available or fails, the exact description is the pre-LLM behavior
    const phrase = (await extractRuleTerm(description)) ?? description

    // two clusters can extract the same term; (phrase, category) is the
    // suggestion's identity, so fold into the existing row when one exists
    const byPhrase = db
      .select()
      .from(ruleSuggestions)
      .where(and(eq(ruleSuggestions.phrase, phrase), eq(ruleSuggestions.categoryId, categoryId)))
      .get()
    if (byPhrase) {
      if (byPhrase.status === 'pending') continue
      db.update(ruleSuggestions)
        .set({ status: 'pending', matchCount: count, source, createdAt: now, updatedAt: now })
        .where(eq(ruleSuggestions.id, byPhrase.id))
        .run()
    } else {
      db.insert(ruleSuggestions)
        .values({
          descriptionKey: description,
          phrase,
          categoryId,
          matchCount: count,
          source,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
    created++
  }

  if (created > 0) sendToRenderer(RULE_SUGGESTIONS_CREATED, { count: created })
}

function listSuggestions(): RuleSuggestion[] {
  const rows = db
    .select({
      id: ruleSuggestions.id,
      descriptionKey: ruleSuggestions.descriptionKey,
      phrase: ruleSuggestions.phrase,
      categoryId: ruleSuggestions.categoryId,
      categoryName: categories.name,
      source: ruleSuggestions.source,
      createdAt: ruleSuggestions.createdAt
    })
    .from(ruleSuggestions)
    .innerJoin(categories, eq(ruleSuggestions.categoryId, categories.id))
    .where(eq(ruleSuggestions.status, 'pending'))
    .all()
  return (
    rows
      .map((r) => ({
        ...r,
        source: r.source as 'user' | 'llm',
        matchCount: countMatching(r.phrase)
      }))
      // a pending row whose cluster shrank below the threshold (e.g. the synced
      // account it came from was disconnected) is hidden, not deleted: it stays
      // suppressed and resurfaces here if the cluster ever grows back
      .filter((r) => r.matchCount >= MIN_IDENTICAL)
      .sort((a, b) => b.matchCount - a.matchCount || b.createdAt - a.createdAt)
  )
}

/**
 * Delete suggestions that no transaction backs anymore. Called after a
 * disconnect wipes synced accounts and their transactions: a suggestion whose
 * phrase now matches nothing can never resurface on its own (nothing left to
 * grow the cluster), so the list's hide-don't-delete treatment would just leave
 * a dead row behind forever, along with the "new rule suggestion" notification
 * it produced. Suggestions still matching surviving manual-account transactions
 * are kept — those aren't stale, they just lost their synced siblings. Runs
 * across every status (pending/dismissed/accepted), since an orphaned dismissal
 * or acceptance is equally dead weight. Returns the number pruned.
 */
export function pruneOrphanedSuggestions(): number {
  const rows = db
    .select({ id: ruleSuggestions.id, phrase: ruleSuggestions.phrase })
    .from(ruleSuggestions)
    .all()
  const orphaned = rows.filter((r) => countMatching(r.phrase) === 0).map((r) => r.id)
  if (orphaned.length === 0) return 0
  db.delete(ruleSuggestions).where(inArray(ruleSuggestions.id, orphaned)).run()
  return orphaned.length
}

function setStatus(id: number, status: 'dismissed' | 'accepted'): boolean {
  db.update(ruleSuggestions)
    .set({ status, updatedAt: Date.now() })
    .where(eq(ruleSuggestions.id, id))
    .run()
  return true
}

/**
 * An accepted pair is blocked from re-suggesting only while a rule actually
 * covers it: re-open any accepted suggestion no enabled rule handles anymore,
 * so deleting a rule brings its suggestion back as pending. Called after a rule
 * is deleted, and once at startup to heal pairs orphaned while the app was
 * closed. Dismissed pairs stay dismissed — that refusal wasn't tied to a rule.
 */
export function reopenUncoveredAcceptedSuggestions(): void {
  if (!suggestionsEnabled()) return
  const accepted = db
    .select()
    .from(ruleSuggestions)
    .where(eq(ruleSuggestions.status, 'accepted'))
    .all()
  if (accepted.length === 0) return

  const rules = loadEnabledRules()
  const now = Date.now()
  let reopened = 0
  for (const row of accepted) {
    if (countMatching(row.phrase) < MIN_IDENTICAL) continue
    if (alreadyCovered(row.phrase, row.categoryId, rules)) continue
    // createdAt moves to now: this is a fresh suggestion event, not the old one
    db.update(ruleSuggestions)
      .set({ status: 'pending', createdAt: now, updatedAt: now })
      .where(eq(ruleSuggestions.id, row.id))
      .run()
    reopened++
  }
  if (reopened > 0) sendToRenderer(RULE_SUGGESTIONS_CREATED, { count: reopened })
}

export function registerRuleSuggestionsIpc(): void {
  // heal accepted pairs whose rule disappeared while the app was closed
  reopenUncoveredAcceptedSuggestions()

  ipcMain.handle(RULE_SUGGESTIONS_IPC.list, (): RuleSuggestion[] => listSuggestions())
  ipcMain.handle(RULE_SUGGESTIONS_IPC.dismiss, (_event, input: unknown): boolean =>
    setStatus(idSchema.parse(input), 'dismissed')
  )
  ipcMain.handle(RULE_SUGGESTIONS_IPC.accept, (_event, input: unknown): boolean =>
    setStatus(idSchema.parse(input), 'accepted')
  )
}
