import type {
  ActionToolName,
  AnalysisToolName,
  AnalysisToolResult,
  ProposalMerchantGroup,
  ProposalToolResult
} from '@shared/chat'
import { plural } from './utils'

// Transcript wording for the typed chat tools, kept free of React so the label
// rules are testable on their own. The thought chain pairs these with icons.

export const PENDING_LABELS: Record<AnalysisToolName | ActionToolName, string> = {
  totals: 'Totaling…',
  goals: 'Checking goals…',
  transactions: 'Finding transactions…',
  budgets: 'Checking budgets…',
  recurring: 'Finding recurring charges…',
  balances: 'Reading balances…',
  what_if: 'Running a what-if…',
  unusual: 'Looking for anything unusual…',
  recategorize: 'Preparing a change…',
  set_budget: 'Preparing a change…',
  update_goal: 'Preparing a change…'
}

const FAILED_LABELS: Record<AnalysisToolName, string> = {
  totals: 'Totals failed',
  goals: 'Goal lookup failed',
  transactions: 'Transaction lookup failed',
  budgets: 'Budget check failed',
  recurring: 'Recurring check failed',
  balances: 'Balance lookup failed',
  what_if: 'What-if failed',
  unusual: 'Unusual check failed'
}

const BY_WORDS: Record<string, string> = {
  category_group: 'category group'
}

/** '2026-06 to 2026-08 (3 complete months)' -> '2026-06 to 2026-08' */
function shortPeriod(period: string | undefined): string | null {
  const text = period?.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return text ? text : null
}

function withPeriod(label: string, period: string | undefined): string {
  const short = shortPeriod(period)
  return short ? `${label} · ${short}` : label
}

function countFact(result: AnalysisToolResult, key: string): number {
  const fact = result.facts?.[key]
  return typeof fact === 'number' ? fact : (result.rowCount ?? result.rows?.length ?? 0)
}

function totalsLabel(args: Record<string, unknown>, result: AnalysisToolResult): string {
  const measure = typeof args.measure === 'string' ? args.measure : 'spending'
  if (result.comparedWith) {
    const now = shortPeriod(result.period)
    const then = shortPeriod(result.comparedWith)
    return now && then ? `Compared ${measure} · ${now} vs ${then}` : `Compared ${measure}`
  }
  const by = typeof args.by === 'string' && args.by !== 'none' ? args.by : null
  const label = by ? `Totaled ${measure} by ${BY_WORDS[by] ?? by}` : `Totaled ${measure}`
  return withPeriod(label, result.period)
}

/** The settled one-line label for a typed analysis call. */
export function analysisToolLabel(
  name: AnalysisToolName,
  args: Record<string, unknown>,
  result: AnalysisToolResult
): string {
  if (!result.ok) return FAILED_LABELS[name]
  switch (name) {
    case 'totals':
      return totalsLabel(args, result)
    case 'goals':
      return args.view === 'history' ? 'Read goal history' : 'Checked goals'
    case 'transactions':
      return `Listed ${plural(result.rows?.length ?? result.rowCount ?? 0, 'transaction')}`
    case 'budgets':
      return withPeriod('Checked budgets', result.period)
    case 'recurring':
      return `Found ${plural(countFact(result, 'count'), 'recurring charge')}`
    case 'balances':
      return 'Read balances'
    case 'what_if':
      return 'Ran a what-if'
    case 'unusual': {
      const flags = countFact(result, 'flags')
      return `Checked for anything unusual · ${flags === 0 ? 'nothing flagged' : plural(flags, 'flag')}`
    }
  }
}

export function actionToolLabel(result: ProposalToolResult): string {
  return result.ok ? 'Proposed a change' : 'Change failed'
}

/** The recategorize groups left checked, as the count and total the Apply button quotes. */
export function selectedGroups(
  groups: ProposalMerchantGroup[],
  merchants: readonly string[]
): { count: number; total: number } {
  const chosen = groups.filter((g) => merchants.includes(g.merchant))
  return {
    count: chosen.reduce((sum, g) => sum + g.transactionIds.length, 0),
    // summed in cents so float noise can't leak into the displayed total
    total: chosen.reduce((sum, g) => sum + Math.round(g.total * 100), 0) / 100
  }
}
