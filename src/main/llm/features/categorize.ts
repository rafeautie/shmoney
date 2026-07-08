import { z } from 'zod'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { accounts, categories, transactions } from '../../db/schema'
import { setCategories } from '../../ipc/transactions'
import { applyRulesInTx } from '../../ipc/rules'
import { llmManager, sendToRenderer } from '../manager'
import { LLM_IPC, type CategorizeResult } from '@shared/llm'
import type { CategorizeScopeInput } from '@shared/ipc'

const generatedSchema = z.object({ categoryId: z.number(), reason: z.string() })

// JSON-schema grammar the worker constrains decoding to. `reason` is generated
// before `categoryId` so the model settles on a rationale first, and the enum
// guarantees the id is always one of the real categories.
function buildSchema(categoryIds: number[]): object {
  return {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      categoryId: { enum: categoryIds }
    },
    required: ['reason', 'categoryId']
  }
}

function buildPrompt(
  t: { description: string; amount: number; account: string },
  allCategories: { id: number; name: string }[]
): string {
  const categoryList = allCategories.map((c) => `${c.id} = ${c.name}`).join('\n')
  const direction = t.amount < 0 ? 'money out' : 'money in'
  const amount = Math.abs(t.amount / 1000).toFixed(2)

  // The grammar enforces the output shape, so the prompt only needs to guide the
  // decision. Kept short and concrete, with the categories and the transaction
  // near the end: Gemma 4 E2B is a small model and weights recent context most.
  return `Assign this bank transaction to the single best-fitting category.

Categories (id = name):
${categoryList}

How to decide:
- Read the description to identify the merchant or purpose. Ignore card and store numbers, dates, locations, and reference codes.
- "money out" is a purchase or a bill; "money in" is usually income, a refund, or a payment received.
- Prefer the most specific category that fits. If none fit well, choose the closest general one.
- categoryId must be one of the ids listed above.
- Set "reason" to a 3-6 word phrase naming the merchant or purpose.

Transaction:
Account: "${t.account}"
Description: "${t.description}"
Amount: ${amount} (${direction})`
}

function reportProgress(processed: number, total: number): void {
  sendToRenderer(LLM_IPC.categorizeProgress, { processed, total })
}

// The controller for the categorize run currently in flight, so Cancel can abort
// it. Only one run happens at a time (the UI disables the trigger while busy).
let activeRun: AbortController | null = null

/** Cancel the in-flight categorize: the current generation stops and partial results still apply. */
export function cancelCategorize(): void {
  activeRun?.abort()
}

/**
 * Categorize a scope of transactions. The user's rules run first over the scope
 * (deterministic and free), then the model handles whatever they didn't settle,
 * applied as one undoable action-log entry (source 'llm'). The scope is an
 * explicit selection (`transactionIds`), a single `accountId`, or — when both are
 * omitted — every transaction. Whatever the scope, rows that are already
 * categorized, transfers, or pending are excluded, the same rule manual bulk
 * category-set follows. Only one run happens at a time: the worker shares one
 * chat session, so an overlapping run would corrupt it.
 */
export async function categorizeTransactions(
  scope: CategorizeScopeInput
): Promise<CategorizeResult> {
  if (activeRun) throw new Error('A categorize run is already in progress.')

  const allCategories = db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .all()
  if (allCategories.length === 0) return { categorized: 0, cancelled: false }
  const categoryIds = new Set(allCategories.map((c) => c.id))

  // No scope → every transaction; an account id → that account; an explicit id
  // list → just those. drizzle's and() drops the undefined, so "all" is simply
  // the eligibility filters with nothing narrowing them.
  const scopeFilter = scope.transactionIds
    ? inArray(transactions.id, scope.transactionIds)
    : scope.accountId
      ? eq(transactions.accountId, scope.accountId)
      : undefined

  // Deterministic rules first: apply the user's rules across this scope so the
  // model only spends generations on rows no rule already settled. Same
  // fill-empty semantics and undoable 'rule' action-log entries as sync/manual
  // apply; a rule that categorizes a row (or marks it a transfer) drops it from
  // the eligible set selected below.
  const ruleResult = db.transaction((tx) => applyRulesInTx(tx, { scope }))

  const eligible = db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      account: accounts.name
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        scopeFilter,
        isNull(transactions.categoryId),
        isNull(transactions.deletedAt),
        eq(transactions.pending, false),
        eq(transactions.isTransfer, false)
      )
    )
    .all()

  // Group the selection by description so identical merchants cost one
  // generation instead of one per row: recurring transactions dominate most
  // selections, so this collapses a lot of duplicate work. The chosen category
  // maps back to every row in the group. The first row stands in for the group
  // in the prompt (amount/account), which is representative for a shared merchant.
  const groups = new Map<string, typeof eligible>()
  for (const t of eligible) {
    const group = groups.get(t.description)
    if (group) group.push(t)
    else groups.set(t.description, [t])
  }
  const groupList = [...groups.values()]

  const schema = buildSchema([...categoryIds])
  const changes: { transactionId: number; categoryId: number }[] = []

  const abortController = new AbortController()
  activeRun = abortController
  const { signal } = abortController
  try {
    // one generation per description group, so progress reflects the actual work
    // (each group is one model call) and reports as each finishes
    for (let i = 0; i < groupList.length; i++) {
      if (signal.aborted) break // cancelled: stop before starting the next group
      const group = groupList[i]
      try {
        const raw = await llmManager.generate(buildPrompt(group[0], allCategories), schema, signal)
        const parsed = generatedSchema.safeParse(raw)
        if (parsed.success && categoryIds.has(parsed.data.categoryId)) {
          for (const t of group) {
            changes.push({ transactionId: t.id, categoryId: parsed.data.categoryId })
          }
        }
      } catch (e) {
        if (signal.aborted) break // cancelled mid-generation
        console.log(e)
        // one bad generation shouldn't fail the whole selection; it's just skipped
      }
      reportProgress(i + 1, groupList.length)
    }

    // apply whatever the model categorized before a cancel, as one undoable
    // entry; the count also includes rows the rules pre-pass settled
    const llmCategorized = changes.length > 0 ? setCategories({ changes, source: 'llm' }) : 0
    return { categorized: ruleResult.categorized + llmCategorized, cancelled: signal.aborted }
  } finally {
    if (activeRun === abortController) activeRun = null
  }
}
