import { z } from 'zod'
import { llmManager } from '../manager'
import { enqueueGenerate } from '../queue'
import { createLogger } from '../../logging'

const log = createLogger('llm')

const generatedSchema = z.object({ phrase: z.string(), reason: z.string() })

// `reason` is generated before `phrase` so the model settles on a rationale
// first (same ordering trick as categorize.ts). Constant, so the worker's
// grammar cache holds across calls.
const SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    phrase: { type: 'string' }
  },
  required: ['reason', 'phrase']
} as const

// The grammar enforces the shape; the prompt has to carry the judgment. The
// contract is stated both positively (what the term is) and negatively (what
// to leave out), with few-shot examples of real bank formats — the highest
// leverage guidance for a small model — and the description last, where Gemma
// weights context most. The output is used as-is (no vetting layer yet): we
// want to observe the model's raw quality before deciding what to guard.
function buildPrompt(description: string): string {
  return `Extract the term an automatic filing rule should match from a bank transaction description.

Requirements:
- The term must appear inside the description exactly as written (same characters, contiguous).
- The term is the merchant or brand name, or the purpose of a recurring payment.
- Leave out store numbers, dates, city and state names, card numbers, and reference codes.
- Leave out processor and payment-rail noise such as POS, DEBIT, ACH, VISA, PURCHASE.
- Never answer with a generic word that could match unrelated merchants, such as PAYMENT, STORE, MARKET, ONLINE, SERVICES.
- If the description is already just a clean merchant name, return it unchanged.
- Set "reason" to a short phrase naming what the term identifies.

Examples:
Description: "TST* CHIPOTLE 0421 DENVER CO" -> phrase: "CHIPOTLE"
Description: "POS DEBIT 4523 STARBUCKS #1082 SEATTLE" -> phrase: "STARBUCKS"
Description: "AMZN Mktp US*2X4AB12" -> phrase: "AMZN Mktp"
Description: "ACH WITHDRAWAL CITY OF PORTLAND WATER" -> phrase: "CITY OF PORTLAND WATER"
Description: "Netflix" -> phrase: "Netflix"

Description: "${description}"`
}

/**
 * Ask the model for the reusable term inside a transaction description,
 * returned raw. Best effort by design: returns null when the model isn't on
 * disk, the generation fails, or the phrase comes back empty (a `contains ""`
 * rule would match everything) — callers fall back to the exact description.
 * Never triggers a download; a merely-downloaded model is loaded by
 * generate() as usual.
 */
export async function extractRuleTerm(description: string): Promise<string | null> {
  // best effort: only proceed when the selected model is on disk (it loads on
  // demand); never triggers a download
  const status = llmManager.getStatus()
  if (status.models[status.selected].stage !== 'downloaded') return null
  try {
    const raw = await enqueueGenerate(() => llmManager.generate(buildPrompt(description), SCHEMA))
    const parsed = generatedSchema.safeParse(raw)
    if (!parsed.success) return null
    return parsed.data.phrase.trim() || null
  } catch (e) {
    // logged serialized, never raw: the error chain can drag the prompt along,
    // and the prompt carries a real transaction description (see categorize.ts)
    log.error('extract-rule-term.generation-failed', e)
    return null
  }
}
