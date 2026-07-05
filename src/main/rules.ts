// Pure rule-matching logic, kept free of DB/IPC so it can be reasoned about and
// unit-tested in isolation (mirrors transfers.ts). The apply/preview handlers
// feed it candidate rows and act on whatever firings come back.

import { getDate } from 'date-fns'
import type {
  Rule,
  RuleAmountCondition,
  RuleConditions,
  RuleDateCondition,
  RuleTextCondition
} from '../shared/rules'

export interface RuleCandidate {
  id: number
  accountId: number
  /** integer milliunits; sign encodes direction */
  amount: number
  description: string
  /** unix seconds; 0 when unknown */
  date: number
  categoryId: number | null
  isTransfer: boolean
}

/** One rule and the transactions it will change, in evaluation order. */
export interface RuleFiring {
  rule: Rule
  ids: number[]
}

function matchText(cond: RuleTextCondition, description: string): boolean {
  const haystack = description.toLowerCase()
  const needle = cond.value.toLowerCase()
  switch (cond.op) {
    case 'contains':
      return haystack.includes(needle)
    case 'equals':
      return haystack === needle
    case 'regex':
      try {
        // case-insensitive for parity with contains/equals; a malformed regex
        // should have been rejected at save time, but never crash a sync
        return new RegExp(cond.value, 'i').test(description)
      } catch {
        return false
      }
  }
}

function matchAmount(cond: RuleAmountCondition, amount: number): boolean {
  if (cond.direction === 'in' && amount <= 0) return false
  if (cond.direction === 'out' && amount >= 0) return false
  const magnitude = Math.abs(amount)
  switch (cond.op) {
    case 'eq':
      return magnitude === cond.value
    case 'gt':
      return magnitude > cond.value
    case 'lt':
      return magnitude < cond.value
    case 'gte':
      return magnitude >= cond.value
    case 'lte':
      return magnitude <= cond.value
    case 'between':
      // value2 presence guaranteed by the schema refine
      return magnitude >= cond.value && magnitude <= (cond.value2 ?? cond.value)
  }
}

function matchDate(cond: RuleDateCondition, date: number): boolean {
  // a row with an unknown date can't satisfy a date condition
  if (date === 0) return false
  if (cond.after !== undefined && date < cond.after) return false
  if (cond.before !== undefined && date > cond.before) return false
  if (cond.dayOfMonthMin !== undefined || cond.dayOfMonthMax !== undefined) {
    const dom = getDate(new Date(date * 1000))
    if (cond.dayOfMonthMin !== undefined && dom < cond.dayOfMonthMin) return false
    if (cond.dayOfMonthMax !== undefined && dom > cond.dayOfMonthMax) return false
  }
  return true
}

/** Every present condition must match (AND). */
export function matchConditions(conditions: RuleConditions, candidate: RuleCandidate): boolean {
  if (conditions.description && !matchText(conditions.description, candidate.description)) return false
  if (conditions.amount && !matchAmount(conditions.amount, candidate.amount)) return false
  if (conditions.accountId !== undefined && candidate.accountId !== conditions.accountId) return false
  if (conditions.date && !matchDate(conditions.date, candidate.date)) return false
  return true
}

/**
 * Work out which rules change which transactions. Enabled rules run in priority
 * order (ties by id). Rules only ever *fill empty* fields — setCategory touches
 * uncategorized, non-transfer rows; markTransfer touches unmarked rows. The
 * first rule that actually acts on a transaction claims it; later rules skip a
 * claimed row, so a transaction is handled by exactly one rule and can't end up
 * both categorized and marked as a transfer. A rule that merely *matches* an
 * ineligible row (e.g. one already categorized) doesn't claim it.
 */
export function evaluateRules(rules: Rule[], candidates: RuleCandidate[]): RuleFiring[] {
  const ordered = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || a.id - b.id)

  const claimed = new Set<number>()
  const firings: RuleFiring[] = []

  for (const rule of ordered) {
    const ids: number[] = []
    for (const c of candidates) {
      if (claimed.has(c.id)) continue
      if (!matchConditions(rule.conditions, c)) continue
      if (rule.action.type === 'setCategory') {
        // a transfer or an already-categorized row is not eligible (fill-empty)
        if (c.categoryId !== null || c.isTransfer) continue
      } else if (c.isTransfer) {
        continue
      }
      ids.push(c.id)
    }
    if (ids.length === 0) continue
    for (const id of ids) claimed.add(id)
    firings.push({ rule, ids })
  }

  return firings
}
