import { eq } from 'drizzle-orm'
import { db } from '../../../demo/db'
import * as schema from '../../db/schema'

// Rows written straight to the database, for state a spec needs but isn't
// testing. Anything under test goes through `api` instead.

let next = 0
const uid = (prefix: string): string => `${prefix}-${++next}`

/** unix seconds at local noon, the way imports and manual rows are dated */
export const noon = (y: number, m: number, d: number): number =>
  new Date(y, m - 1, d, 12).getTime() / 1000

export function account(over: Partial<typeof schema.accounts.$inferInsert> = {}): number {
  return db
    .insert(schema.accounts)
    .values({ name: uid('Account'), currency: 'USD', balance: 0, balanceDate: 0, ...over })
    .returning({ id: schema.accounts.id })
    .get().id
}

export function txn(
  accountId: number,
  over: Partial<typeof schema.transactions.$inferInsert> = {}
): number {
  return db
    .insert(schema.transactions)
    .values({
      accountId,
      simplefinId: uid('manual:t'),
      posted: noon(2026, 9, 1),
      amount: -10_000,
      description: uid('Txn'),
      ...over
    })
    .returning({ id: schema.transactions.id })
    .get().id
}

export function group(name = uid('Group')): number {
  return db
    .insert(schema.categoryGroups)
    .values({ name })
    .returning({ id: schema.categoryGroups.id })
    .get().id
}

export function category(name = uid('Category'), groupId: number | null = null): number {
  return db
    .insert(schema.categories)
    .values({ name, groupId })
    .returning({ id: schema.categories.id })
    .get().id
}

/** a rule matching descriptions that contain `phrase` */
export function rule(name: string, phrase: string, categoryId: number, priority = 0): number {
  const now = 1_700_000_000
  return db
    .insert(schema.rules)
    .values({
      name,
      priority,
      conditions: { description: { op: 'contains', phrases: [phrase] } },
      action: { type: 'setCategory', categoryId },
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: schema.rules.id })
    .get().id
}

export function systemCategory(key: 'transfers' | 'income' | 'opening'): number {
  return db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.systemKey, key))
    .get()!.id
}
