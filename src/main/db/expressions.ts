import { sql } from 'drizzle-orm'
import { transactions } from './schema'

// Shared SQL expressions over the schema. Free of the live db handle so pure,
// unit-testable modules can build predicates with them (see accounts/balance.ts
// and the same split in rules.ts).

/**
 * A transaction's effective date, as a unix epoch, 0 when unknown.
 *
 * SimpleFIN sends posted = 0 for pending transactions; their real date is
 * transacted_at. Derived rather than stored, so every consumer agrees.
 */
export const transactionDate = sql<number>`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, 0)`
