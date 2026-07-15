// Compiles a rule's conditions into a parameterized SQL predicate, so matching
// runs in the database rather than in JS over loaded rows (mirrors the LIKE
// filters in reports/query.ts). The apply/preview handlers AND this against
// their base filters to find the rows a rule touches. Kept free of the live db
// handle and Electron so it can be unit-tested in isolation.
import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import { transactions } from './db/schema'
import type {
  RuleAmountCondition,
  RuleConditions,
  RuleDateCondition,
  RuleTextCondition
} from '../shared/rules'

// effective transaction date in unix seconds, 0 when unknown. Mirrors
// transactionDate in ipc/transactions-page.ts, duplicated here so this module
// stays free of the db/Electron import chain and remains unit-testable.
const effectiveDate = sql`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, 0)`

// escape LIKE's wildcards so a phrase matches literally (mirrors reports/query.ts)
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function textPredicate(cond: RuleTextCondition): SQL {
  // lower() both sides so matching is case-insensitive regardless of the
  // case_sensitive_like pragma (parity with the old toLowerCase compare)
  const col = sql`lower(${transactions.description})`
  const parts = cond.phrases.map((phrase) =>
    cond.op === 'contains'
      ? sql`${col} like lower(${'%' + escapeLike(phrase) + '%'}) escape '\\'`
      : sql`${col} = lower(${phrase})`
  )
  return or(...parts)!
}

function amountPredicate(cond: RuleAmountCondition): SQL {
  // compares magnitude so the user never reasons about the sign
  const magnitude = sql`abs(${transactions.amount})`
  const parts: SQL[] = []
  if (cond.direction === 'in') parts.push(sql`${transactions.amount} > 0`)
  if (cond.direction === 'out') parts.push(sql`${transactions.amount} < 0`)
  switch (cond.op) {
    case 'eq':
      parts.push(sql`${magnitude} = ${cond.value}`)
      break
    case 'gt':
      parts.push(sql`${magnitude} > ${cond.value}`)
      break
    case 'lt':
      parts.push(sql`${magnitude} < ${cond.value}`)
      break
    case 'gte':
      parts.push(sql`${magnitude} >= ${cond.value}`)
      break
    case 'lte':
      parts.push(sql`${magnitude} <= ${cond.value}`)
      break
    case 'between':
      // value2 presence guaranteed by the schema refine
      parts.push(
        sql`${magnitude} >= ${cond.value} and ${magnitude} <= ${cond.value2 ?? cond.value}`
      )
      break
  }
  return and(...parts)!
}

function datePredicate(cond: RuleDateCondition): SQL {
  const parts: SQL[] = [sql`${effectiveDate} != 0`] // an unknown date satisfies nothing
  if (cond.after !== undefined) parts.push(sql`${effectiveDate} >= ${cond.after}`)
  if (cond.before !== undefined) parts.push(sql`${effectiveDate} <= ${cond.before}`)
  if (cond.dayOfMonthMin !== undefined || cond.dayOfMonthMax !== undefined) {
    // 'localtime' so day-of-month follows the user's calendar, as getDate() did
    const dom = sql`cast(strftime('%d', ${effectiveDate}, 'unixepoch', 'localtime') as integer)`
    if (cond.dayOfMonthMin !== undefined) parts.push(sql`${dom} >= ${cond.dayOfMonthMin}`)
    if (cond.dayOfMonthMax !== undefined) parts.push(sql`${dom} <= ${cond.dayOfMonthMax}`)
  }
  return and(...parts)!
}

/**
 * A parameterized SQL predicate true for the transactions a rule's conditions
 * match. Every present condition is ANDed (mirrors the old matchConditions);
 * ruleConditionsSchema guarantees at least one condition, so the result is never
 * empty.
 */
export function compileConditions(conditions: RuleConditions): SQL {
  const parts: SQL[] = []
  if (conditions.description) parts.push(textPredicate(conditions.description))
  if (conditions.amount) parts.push(amountPredicate(conditions.amount))
  if (conditions.accountId !== undefined) {
    parts.push(eq(transactions.accountId, conditions.accountId))
  }
  if (conditions.date) parts.push(datePredicate(conditions.date))
  return and(...parts)!
}
